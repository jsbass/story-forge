// Generation queue: turn manifest entries into candidates via ComfyUI, one GPU job at a time.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readJson, writeJson, toPosix } from '../lib/util.mjs';
import { loadProject } from '../lib/project.mjs';
import { Comfy, DEFAULT_COMFY_URL } from './comfy.mjs';
import { getWorkflow, bindWorkflow, validateWorkflow, ref } from './workflows.mjs';
import { loadManifest, saveManifest, key, findAsset } from './manifest.mjs';
import { FORGE_HOME } from './assess.mjs';

const jobsFile = (root) => path.join(root, 'state', 'asset-jobs.json');

export function loadJobs(root) {
  return readJson(jobsFile(root));
}

function saveJobs(root, j) {
  writeJson(jobsFile(root), j);
}

function recordBenchmark(wfRef, seconds) {
  const f = path.join(FORGE_HOME, 'benchmarks.json');
  const b = readJson(f, {});
  const e = b[wfRef] || { runs: 0, avg_seconds: 0 };
  e.avg_seconds = +((e.avg_seconds * e.runs + seconds) / (e.runs + 1)).toFixed(1);
  e.runs += 1;
  b[wfRef] = e;
  writeJson(f, b);
}

const join = (...parts) => parts.map((p) => (p || '').trim().replace(/^,|,$/g, '').trim()).filter(Boolean).join(', ');

/** Final parameter values for one asset run (only params the workflow declares are kept). */
export function composeValues(wf, asset, art = {}, { seed, prefix }) {
  const v = {
    ...(asset.params || {}),
    prompt: asset.kind === 'music' || asset.kind === 'sfx' || asset.kind === 'ambience' ? join(asset.prompt) : join(art.prompt_prefix, asset.prompt),
    negative: join(art.negative, asset.negative),
    seed,
    filename_prefix: prefix,
  };
  if (wf.params.checkpoint?.any_model) v.checkpoint = asset.params?.checkpoint || art.checkpoint || null;
  const out = {};
  for (const k of Object.keys(wf.params)) if (v[k] !== undefined && v[k] !== null && v[k] !== '') out[k] = v[k];
  // Some models expect a fixed prompt shape, e.g. Stable Audio 3: "<description> Length: 6 seconds".
  if (wf.prompt_template && out.prompt) {
    const vals = { ...Object.fromEntries(Object.entries(wf.params).map(([k, p]) => [k, p.default])), ...out };
    out.prompt = wf.prompt_template.replace(/\{(\w+)\}/g, (_, k) => (vals[k] ?? ''));
  }
  return out;
}

/**
 * Generate candidates.
 * @param o.ids     asset ids (kind:id or id); default = every requested/rejected asset with a prompt
 * @param o.count   candidates per asset this run (capped by limits.generations_per_asset in total)
 * @param o.draft   use the fast sdxl-draft workflow for image assets
 */
export async function generateAssets(root, { ids = [], kinds = [], count = 1, draft = false, log = console.log } = {}) {
  const project = loadProject(root);
  const art = project.config.art || {};
  const limit = project.config.limits?.generations_per_asset ?? 4;
  const comfy = new Comfy(project.config.comfyui?.url || DEFAULT_COMFY_URL);
  await comfy.systemStats();

  let m = loadManifest(root);
  const targets = ids.length
    ? ids.map((id) => findAsset(m, id))
    : m.assets.filter((a) => !a.unused && ['requested', 'rejected'].includes(a.status) && a.prompt && (!kinds.length || kinds.includes(a.kind)));
  const missingPrompt = targets.filter((a) => !a.prompt).map(key);
  if (missingPrompt.length) throw new Error(`These assets have no prompt yet: ${missingPrompt.join(', ')} (forge assets set <id> --prompt "...")`);

  const jobs = { pid: process.pid, started: new Date().toISOString(), total: targets.length * count, done: 0, current: null, errors: [], results: [], finished: null };
  saveJobs(root, jobs);
  const validated = new Map();

  for (const target of targets) {
    for (let i = 0; i < count; i++) {
      m = loadManifest(root); // re-read: a reviewer may have changed it meanwhile
      const a = findAsset(m, key(target));
      const real = (a.candidates || []).filter((c) => !c.draft).length;
      if (!draft && real >= limit) {
        jobs.errors.push({ asset: key(a), error: `Reached ${limit} generations (limits.generations_per_asset). Review the candidates or raise the limit.` });
        break;
      }
      const isImage = ['bg', 'portrait', 'ui'].includes(a.kind);
      const wf = getWorkflow(root, draft && isImage ? 'sdxl-draft' : a.workflow);
      const seed = crypto.randomInt(0, 2 ** 47);
      const values = composeValues(wf, a, art, { seed, prefix: `forge/${a.kind}/${a.id}` });
      if (draft && isImage && a.params?.width && a.params?.height) {
        const scale = 768 / Math.max(a.params.width, a.params.height);
        values.width = Math.round((a.params.width * scale) / 64) * 64;
        values.height = Math.round((a.params.height * scale) / 64) * 64;
      }
      // Reference image uploads (e.g. IP-Adapter portraits use the approved character reference).
      for (const [name, p] of Object.entries(wf.params)) {
        if (!p.upload) continue;
        const local = values[name] || (a.character ? m.assets.find((x) => x.kind === 'portrait' && x.id === `${a.character}.ref`)?.approved?.file : null);
        if (!local) throw new Error(`${key(a)}: workflow ${wf.id} needs '${name}' (approve ${a.character}.ref first, or pass --param ${name}=<file>)`);
        values[name] = await comfy.uploadImage(path.join(root, local));
      }
      const vkey = `${ref(wf)}|${values.checkpoint || ''}`;
      if (!validated.has(vkey)) validated.set(vkey, await validateWorkflow(comfy, wf, values));
      const v = validated.get(vkey);
      if (!v.ok) {
        const why = [...v.missingModels.map((x) => `${x.folder}/${x.file}`), ...v.missingNodes.map((n) => `node ${n}`)].join(', ');
        a.status = a.status === 'requested' ? 'blocked_capability' : a.status;
        a.notes.push({ at: new Date().toISOString(), note: `Can't run ${ref(wf)}: missing ${why}` });
        saveManifest(root, m);
        jobs.errors.push({ asset: key(a), error: `missing ${why}` });
        break;
      }

      jobs.current = { asset: key(a), attempt: i + 1, workflow: ref(wf), started: new Date().toISOString() };
      saveJobs(root, jobs);
      log(`[${jobs.done + 1}/${jobs.total}] ${key(a)} via ${ref(wf)} seed ${seed}`);
      const t0 = Date.now();
      try {
        const { graph } = bindWorkflow(wf, values);
        const { prompt_id } = await comfy.queue(graph);
        const entry = await comfy.wait(prompt_id);
        const files = Comfy.outputFiles(entry).filter((f) => f.type === 'output');
        if (!files.length) throw new Error('ComfyUI finished but produced no output files');
        const seconds = +((Date.now() - t0) / 1000).toFixed(1);
        recordBenchmark(ref(wf), seconds);
        m = loadManifest(root);
        const a2 = findAsset(m, key(target));
        for (const f of files) {
          const ext = path.extname(f.filename) || `.${wf.outputs?.ext || 'bin'}`;
          const rel = toPosix(path.join('assets', 'raw', a2.kind, a2.id, `${a2.id}_${seed}${draft ? '_draft' : ''}${files.length > 1 ? `_${files.indexOf(f)}` : ''}${ext}`));
          await comfy.download(f, path.join(root, rel));
          a2.candidates.push({ file: rel, seed, workflow: ref(wf), params: Object.fromEntries(Object.entries(values).filter(([k]) => !['prompt', 'negative', 'filename_prefix'].includes(k))), prompt: values.prompt, draft: !!draft, seconds, at: new Date().toISOString() });
        }
        if (a2.status !== 'approved') a2.status = 'generated';
        saveManifest(root, m);
        jobs.results.push({ asset: key(a2), seconds, files: files.length });
        log(`    done in ${seconds}s`);
      } catch (e) {
        jobs.errors.push({ asset: key(a), error: e.message });
        log(`    FAILED: ${e.message}`);
      }
      jobs.done += 1;
      saveJobs(root, jobs);
    }
  }
  jobs.current = null;
  jobs.finished = new Date().toISOString();
  saveJobs(root, jobs);
  return jobs;
}
