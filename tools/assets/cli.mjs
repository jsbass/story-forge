// CLI handlers for `forge assess`, `forge models ...`, `forge assets ...`
import fs from 'node:fs';
import path from 'node:path';
import { loadProject } from '../lib/project.mjs';
import { writeJson, readJson, writeText, toPosix } from '../lib/util.mjs';
import { addFeedback } from '../lib/feedback.mjs';
import { DEFAULT_COMFY_URL, Comfy } from './comfy.mjs';
import { assess, formatProfile, FORGE_HOME } from './assess.mjs';
import { installCatalogModel, installNodePack, civitaiSearch, installCivitai } from './install.mjs';
import { loadCatalog } from './assess.mjs';
import {
  loadManifest, saveManifest, syncManifest, findAsset, approveAsset, rejectAsset, key,
  loadCapabilities, writeCapabilities, upgradeReport, applyCapabilities, summarizeManifest,
} from './manifest.mjs';
import { generateAssets, loadJobs } from './generate.mjs';
import { writeGallery } from './gallery.mjs';
import { listWorkflows, validateWorkflow, promoteWorkflow, getWorkflow } from './workflows.mjs';
import { serveReview } from '../build/serve.mjs';

const out = (data, json) => console.log(json ? JSON.stringify(data, null, 2) : data);
const comfyUrl = (root, flags) => flags.url || (root && loadProject(root).config.comfyui?.url) || DEFAULT_COMFY_URL;

function requireYes(flags, what) {
  if (!flags.yes) throw new Error(`${what} downloads or installs software. Ask the user first, then re-run with --yes.`);
}

/** forge assess: scan hardware + ComfyUI, save the profile (machine-wide and per project). */
export async function assessCommand(root, flags) {
  const profile = await assess({ comfyUrl: comfyUrl(root, flags), root });
  writeJson(path.join(FORGE_HOME, 'capabilities.json'), profile);
  let changes = null;
  if (root) {
    const before = loadCapabilities(root);
    writeCapabilities(root, profile);
    if (fs.existsSync(path.join(root, 'assets', 'manifest.yaml'))) {
      const m = loadManifest(root);
      const report = upgradeReport(m, before, profile);
      changes = { ...report, ...applyCapabilities(m, profile) };
      saveManifest(root, m);
    }
  }
  if (flags.json) return out({ ...profile, manifestChanges: changes }, true);
  out(formatProfile(profile));
  if (changes && (changes.unblocked.length || changes.improvable.length || changes.blocked.length || changes.switched?.length)) {
    console.log('\nAsset manifest:');
    if (changes.unblocked.length) console.log(`  now possible: ${changes.unblocked.join(', ')}`);
    if (changes.improvable.length) console.log(`  could be regenerated at higher quality: ${changes.improvable.join(', ')}`);
    if (changes.blocked.length) console.log(`  blocked (capability missing): ${changes.blocked.join(', ')}`);
    if (changes.switched?.length) console.log(`  switched to a workflow this machine can run: ${changes.switched.join('; ')}`);
  }
}

export async function modelsCommand(root, pos, flags) {
  const sub = pos[0];
  if (sub === 'catalog') {
    const c = loadCatalog();
    return out(flags.json ? c.models : c.models.map((m) => `${m.id.padEnd(22)} ${m.capability.padEnd(16)} ~${m.files.reduce((n, f) => n + (f.approx_gb || 0), 0).toFixed(1)} GB  ${m.title}`).join('\n'), flags.json);
  }
  if (sub === 'install') {
    requireYes(flags, `Installing '${pos[1]}'`);
    const r = await installCatalogModel(pos[1]);
    for (const f of r.results) console.log(`${f.status.padEnd(18)} ${f.file}${f.error ? ` - ${f.error}` : ''}${f.instructions ? `\n  ${f.instructions}` : ''}`);
    if (r.node_pack) console.log(`\nThis model also needs the node pack ${r.node_pack.name}: forge models node-pack ${pos[1]} --yes`);
    console.log('\nRe-scan with: forge assess');
    return;
  }
  if (sub === 'node-pack') {
    requireYes(flags, `Installing a node pack for '${pos[1]}'`);
    const m = loadCatalog().models.find((x) => x.id === pos[1]);
    if (!m?.node_pack) throw new Error(`Catalog model '${pos[1]}' has no node pack`);
    const prof = readJson(path.join(FORGE_HOME, 'capabilities.json'));
    const r = installNodePack(m.node_pack, prof?.comfyui?.install_dir);
    console.log(`${r.status}: ${r.target}${r.restart ? `\n${r.restart}` : ''}`);
    return;
  }
  if (sub === 'search') {
    const res = await civitaiSearch(pos.slice(1).join(' '), { types: flags.type || 'Checkpoint', baseModels: flags.base ? String(flags.base).split(',') : undefined });
    return out(flags.json ? res : res.map((r) => `${String(r.versionId).padEnd(9)} ${r.name} (${r.version}) [${r.baseModel}] ${r.gb ?? '?'} GB · ${r.downloads ?? 0} downloads · ${r.page}`).join('\n') || 'No results.', flags.json);
  }
  if (sub === 'install-civitai') {
    requireYes(flags, `Installing Civitai version ${pos[1]}`);
    const r = await installCivitai(pos[1]);
    console.log(`${r.status}${r.dest ? ` -> ${r.dest}` : ''}${r.instructions ? `\n${r.instructions}` : ''}${r.trainedWords?.length ? `\nTrigger words: ${r.trainedWords.join(', ')}` : ''}`);
    return;
  }
  throw new Error('Usage: forge models catalog | install <id> --yes | node-pack <id> --yes | search <query> [--type LORA] | install-civitai <versionId> --yes');
}

function parseParams(list) {
  const params = {};
  for (const kv of [].concat(list || [])) {
    const [k, ...rest] = String(kv).split('=');
    const v = rest.join('=');
    params[k] = v === '' ? null : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v;
  }
  return params;
}

export async function assetsCommand(root, pos, flags) {
  const sub = pos[0] || 'list';
  const project = loadProject(root);

  if (sub === 'sync') {
    const r = syncManifest(root, project, { capabilities: loadCapabilities(root) });
    return out(flags.json ? r : `Manifest: ${r.total} assets. Added ${r.added.length}${r.added.length ? ` (${r.added.join(', ')})` : ''}. ${r.unused.length ? `No longer referenced: ${r.unused.join(', ')}. ` : ''}${r.blocked.length ? `Blocked (capability missing): ${r.blocked.length}. ` : ''}${loadCapabilities(root) ? '' : '\nTip: run forge assess so assets your setup cannot make yet are marked blocked.'}`, flags.json);
  }

  if (sub === 'list') {
    const m = loadManifest(root);
    let items = m.assets.filter((a) => flags.all || !a.unused);
    if (flags.status) items = items.filter((a) => String(flags.status).split(',').includes(a.status));
    if (flags.kind) items = items.filter((a) => String(flags.kind).split(',').includes(a.kind));
    if (flags.json) return out(items, true);
    const s = summarizeManifest(m);
    console.log(`${s.total} assets: ${Object.entries(s.byStatus).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    for (const a of items) console.log(`  ${a.status.padEnd(18)} ${key(a).padEnd(32)} ${a.candidates.length} cand  ${a.prompt ? a.prompt.slice(0, 60) : '(no prompt)'}${a.unused ? '  [unused]' : ''}`);
    const jobs = loadJobs(root);
    if (jobs && !jobs.finished) console.log(`\nGenerating: ${jobs.done}/${jobs.total}${jobs.current ? ` - now ${jobs.current.asset}` : ''}`);
    return;
  }

  if (sub === 'show') return out(findAsset(loadManifest(root), pos[1]), true);

  if (sub === 'set') {
    const m = loadManifest(root);
    const a = findAsset(m, pos[1]);
    if (typeof flags.prompt === 'string') a.prompt = flags.prompt;
    if (typeof flags.negative === 'string') a.negative = flags.negative;
    if (typeof flags.workflow === 'string') { getWorkflow(root, flags.workflow); a.workflow = flags.workflow; }
    if (flags.param) Object.assign(a.params, parseParams(flags.param));
    if (a.status === 'rejected' && flags.prompt) a.status = 'requested';
    saveManifest(root, m);
    return out(flags.json ? a : `${key(a)} updated`, flags.json);
  }

  if (sub === 'generate') {
    const jobs = await generateAssets(root, {
      ids: pos.slice(1),
      kinds: flags.kind ? String(flags.kind).split(',') : [],
      count: Number(flags.count) || 1,
      draft: !!flags.draft,
    });
    console.log(`Generated ${jobs.results.length} candidate set(s); ${jobs.errors.length} problem(s).`);
    for (const e of jobs.errors) console.log(`  ${e.asset}: ${e.error}`);
    const g = writeGallery(root);
    console.log(`Review: ${toPosix(path.relative(root, g.file))} (or: node .forge/forge.mjs assets review)`);
    if (jobs.errors.length) process.exitCode = 1;
    return;
  }

  if (sub === 'gallery') {
    const g = writeGallery(root, { kinds: flags.kind ? String(flags.kind).split(',') : [] });
    return console.log(`${g.count} asset(s) -> ${toPosix(path.relative(root, g.file))}`);
  }

  if (sub === 'review') {
    writeGallery(root);
    serveReview(root, {
      port: Number(flags.port) || 4174,
      decide: async (body) => decide(root, body),
    });
    return;
  }

  if (sub === 'approve') {
    const r = await decide(root, { action: 'approve', id: pos[1], candidate: flags.candidate !== undefined ? Number(flags.candidate) : null });
    return console.log(r.message);
  }
  if (sub === 'reject') {
    const r = await decide(root, { action: 'reject', id: pos[1], note: typeof flags.note === 'string' ? flags.note : '' });
    return console.log(r.message);
  }

  if (sub === 'workflows') {
    const wfs = [...listWorkflows(root).values()];
    let comfy = null;
    if (flags.validate) comfy = new Comfy(comfyUrl(root, flags));
    const rows = [];
    for (const wf of wfs) {
      const v = comfy ? await validateWorkflow(comfy, wf) : null;
      rows.push({ id: wf.id, version: wf.version, scope: wf.scope, capability: wf.capability, status: wf.status, ok: v?.ok ?? null, missing: v ? [...v.missingModels.map((x) => `${x.folder}/${x.file}`), ...v.missingNodes] : [] });
    }
    return out(flags.json ? rows : rows.map((r) => `${r.ok === null ? ' ' : r.ok ? '✅' : '❌'} ${(r.id + '@' + r.version).padEnd(28)} ${r.scope.padEnd(8)} ${r.capability.padEnd(16)} ${r.status}${r.missing.length ? `  missing: ${r.missing.join(', ')}` : ''}`).join('\n'), flags.json);
  }

  if (sub === 'promote') return console.log(`Copied to ${promoteWorkflow(root, pos[1])}`);

  if (sub === 'lora-dataset') return console.log(loraDataset(root, pos[1], flags));

  throw new Error('Usage: forge assets sync | list | show <id> | set <id> --prompt ... [--param k=v] | generate [ids] [--count n] [--draft] | gallery | review | approve <id> [--candidate n] | reject <id> --note ... | workflows [--validate] | promote <workflow> | lora-dataset <character>');
}

/** Shared by CLI and the review server. */
export async function decide(root, { action, id, candidate = null, note = '' }) {
  const m = loadManifest(root);
  if (action === 'approve') {
    const a = approveAsset(root, m, id, candidate);
    saveManifest(root, m);
    writeGallery(root);
    return { message: `${key(a)}: approved candidate #${a.approved.candidate} -> ${a.approved.file}` };
  }
  if (action === 'reject') {
    if (!note) throw new Error('A rejection needs a note saying what should change');
    const a = rejectAsset(m, id, note);
    saveManifest(root, m);
    const fb = addFeedback(root, { text: `${key(a)}: ${note}`, stage: 'assets', targets: ['assets/manifest.yaml'], route: 'asset-generator', source: 'asset-review' });
    writeGallery(root);
    return { message: `${key(a)}: rejected (${fb.id} -> asset-generator)` };
  }
  throw new Error(`Unknown action '${action}'`);
}

/** Collect a character's approved/generated portraits into a kohya-style LoRA training folder. */
function loraDataset(root, character, flags) {
  if (!character) throw new Error('Usage: forge assets lora-dataset <character>');
  const m = loadManifest(root);
  const trigger = typeof flags.trigger === 'string' ? flags.trigger : `${character}_forge`;
  const repeats = Number(flags.repeats) || 10;
  const dir = path.join(root, 'assets', 'lora', character, 'img', `${repeats}_${trigger}`);
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const a of m.assets.filter((x) => x.kind === 'portrait' && x.character === character)) {
    const picks = a.approved ? [a.candidates[a.approved.candidate]] : flags['include-unapproved'] ? a.candidates.filter((c) => !c.draft) : [];
    for (const c of picks.filter(Boolean)) {
      const src = path.join(root, c.file);
      if (!fs.existsSync(src)) continue;
      const base = `${a.id}_${c.seed}`;
      fs.copyFileSync(src, path.join(dir, base + path.extname(c.file)));
      writeText(path.join(dir, base + '.txt'), `${trigger}, ${a.expression || ''}, ${c.prompt || a.prompt || ''}`.replace(/,\s*,/g, ','));
      n++;
    }
  }
  writeText(path.join(root, 'assets', 'lora', character, 'README.md'), `# LoRA dataset: ${character}

- Images: ${n} (aim for 15-30 varied poses/expressions; approve more portraits or use --include-unapproved)
- Trigger word: \`${trigger}\`
- Folder layout is kohya_ss / OneTrainer compatible: \`img/${repeats}_${trigger}/\` with one caption .txt per image.

Training on 8 GB VRAM (SDXL): network dim 16-32, batch 1, gradient checkpointing, cache latents, fp16/bf16, Adafactor, ~1500-2500 steps.
Install a trainer (kohya_ss or OneTrainer) as a Stability Matrix package only with the user's approval.
Put the result in Stability Matrix Models/Lora/forge/<project>/${character}.safetensors and reference it in characters/${character}.yaml (visual.lora).
`);
  return `${n} image(s) -> ${toPosix(path.relative(root, dir))}${n < 15 ? ' (fewer than 15 - LoRA quality will suffer)' : ''}`;
}
