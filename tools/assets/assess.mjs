// Platform Assessor: what can this machine generate, and what would unlock more?
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PLUGIN_ROOT } from '../lib/project.mjs';
import { readJson, listFiles } from '../lib/util.mjs';
import { Comfy } from './comfy.mjs';
import { listWorkflows, validateWorkflow } from './workflows.mjs';

export const FORGE_HOME = path.join(os.homedir(), '.forge');

export function loadCatalog() {
  return readJson(path.join(PLUGIN_ROOT, 'assets-catalog.json'));
}

/** Stability Matrix library (shared Models folder). Override with FORGE_SM_DIR. */
export function stabilityMatrixDir() {
  const candidates = [process.env.FORGE_SM_DIR, process.env.APPDATA && path.join(process.env.APPDATA, 'StabilityMatrix'), path.join(os.homedir(), '.config', 'StabilityMatrix')].filter(Boolean);
  return candidates.find((d) => fs.existsSync(path.join(d, 'Models'))) || null;
}

export function hardware() {
  const hw = { cpu: os.cpus()[0]?.model?.trim(), cores: os.cpus().length, ram_gb: Math.round(os.totalmem() / 1e9), gpu: null, vram_gb: null };
  try {
    const out = execFileSync('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const [name, mem, driver] = out.trim().split('\n')[0].split(',').map((s) => s.trim());
    Object.assign(hw, { gpu: name, vram_gb: Math.round(Number(mem) / 1024), driver });
  } catch { /* no NVIDIA GPU or nvidia-smi */ }
  return hw;
}

function diskFreeGb(dir) {
  try { const s = fs.statfsSync(dir); return Math.round((s.bavail * s.bsize) / 1e9); } catch { return null; }
}

/** Unfinished Stability Matrix downloads and half-installed model sets. */
export function smIssues(smDir) {
  if (!smDir) return [];
  return listFiles(path.join(smDir, 'Models'), (f) => f.endsWith('.smdownload')).map((f) => ({
    kind: 'incomplete-download',
    file: path.relative(smDir, f),
    gb: +(fs.statSync(f).size / 1e9).toFixed(2),
  }));
}

/** Installed checkpoints with Stability Matrix metadata (base model, tags) when available. */
export function installedCheckpoints(smDir, comfyList = []) {
  return comfyList.map((file) => {
    const base = file.replace(/\.[^.]+$/, '');
    const info = smDir ? readJson(path.join(smDir, 'Models', 'StableDiffusion', `${base}.cm-info.json`)) : null;
    return { file, name: info?.ModelName || base, base_model: info?.BaseModel || null, tags: info?.Tags?.slice(0, 6) || [] };
  });
}

/**
 * Full assessment. Requires ComfyUI to be running for model/node checks.
 * @returns capabilities profile (written to state/capabilities.yaml by the CLI)
 */
export async function assess({ comfyUrl, root = null } = {}) {
  const catalog = loadCatalog();
  const comfy = new Comfy(comfyUrl);
  const hw = hardware();
  const smDir = stabilityMatrixDir();
  const profile = {
    scanned_at: new Date().toISOString(),
    hardware: { ...hw, disk_free_gb: diskFreeGb(smDir || os.homedir()) },
    comfyui: { url: comfy.url, reachable: false },
    stability_matrix: smDir ? { dir: smDir, models_dir: path.join(smDir, 'Models') } : null,
    checkpoints: [],
    capabilities: {},
    issues: smIssues(smDir),
    upgrades: [],
  };

  let stats = null;
  try { stats = await comfy.systemStats(); } catch (e) { profile.comfyui.error = e.message; }
  if (stats) {
    const argv = stats.system?.argv || [];
    profile.comfyui = {
      url: comfy.url,
      reachable: true,
      version: stats.system?.comfyui_version,
      host: argv[0]?.includes('StabilityMatrix') ? 'StabilityMatrix' : 'standalone',
      install_dir: argv[0] ? path.dirname(argv[0]) : null,
      vram_free_gb: stats.devices?.[0] ? +(stats.devices[0].vram_free / 1e9).toFixed(1) : null,
    };
    profile.checkpoints = installedCheckpoints(smDir, await comfy.models('checkpoints'));
  }

  const wfs = listWorkflows(root);
  for (const [cap, def] of Object.entries(catalog.capabilities)) {
    const result = { label: def.label, status: 'missing', workflows: [] };
    if (stats) {
      for (const id of def.workflows) {
        const wf = wfs.get(id);
        if (!wf) continue;
        const v = await validateWorkflow(comfy, wf);
        result.workflows.push({ id, version: wf.version, tested: wf.status === 'tested', ok: v.ok, missing_nodes: v.missingNodes, missing_models: v.missingModels.map((m) => `${m.folder}/${m.file}`) });
      }
      if (result.workflows.some((w) => w.ok)) result.status = 'ready';
      else if (result.workflows.length && result.workflows.every((w) => !w.missing_models.length)) result.status = 'needs-nodes';
    } else {
      result.status = 'unknown';
    }
    if (cap === 'tts') result.note = catalog.notes.tts;
    profile.capabilities[cap] = result;
  }

  // Upgrade proposals for anything not ready.
  const vram = hw.vram_gb || 0;
  for (const m of [...catalog.models].sort((a, b) => a.priority - b.priority)) {
    const cap = profile.capabilities[m.capability];
    if (!cap || cap.status === 'ready') continue;
    const installed = [];
    for (const f of m.files) {
      const list = stats ? await comfy.models(f.comfy_folder) : [];
      const onDisk = !!smDir && fs.existsSync(path.join(smDir, 'Models', f.sm_folder, f.filename));
      installed.push(list.includes(f.filename) || onDisk);
    }
    // Everything already on disk but ComfyUI can't confirm (not running / needs restart): not an upgrade to offer.
    if (installed.every(Boolean) && !stats) continue;
    profile.upgrades.push({
      id: m.id,
      capability: m.capability,
      title: m.title,
      why: m.why,
      license: m.license,
      download_gb: +m.files.filter((_, i) => !installed[i]).reduce((n, f) => n + (f.approx_gb || 0), 0).toFixed(2),
      fits_vram: vram ? m.vram_gb <= vram : null,
      gated: m.files.some((f) => f.gated && !installed[m.files.indexOf(f)]),
      node_pack: m.node_pack?.name || null,
      files: m.files.map((f, i) => ({ filename: f.filename, folder: f.sm_folder, installed: installed[i] })),
    });
  }
  // 'needs-nodes' only when the models are already there; otherwise it's simply missing.
  for (const u of profile.upgrades) {
    const cap = profile.capabilities[u.capability];
    if (cap.status === 'needs-nodes' && u.files.some((f) => !f.installed)) cap.status = 'missing';
  }
  profile.benchmarks = readJson(path.join(FORGE_HOME, 'benchmarks.json'), {});
  return profile;
}

/** Human-readable summary of a profile. */
export function formatProfile(p) {
  const L = [];
  const hw = p.hardware;
  L.push(`Hardware: ${hw.gpu || 'no NVIDIA GPU detected'}${hw.vram_gb ? ` (${hw.vram_gb} GB VRAM)` : ''}, ${hw.ram_gb} GB RAM, ${hw.cpu}; ${hw.disk_free_gb ?? '?'} GB free`);
  L.push(p.comfyui.reachable ? `ComfyUI ${p.comfyui.version} at ${p.comfyui.url} (${p.comfyui.host})` : `ComfyUI NOT reachable at ${p.comfyui.url}: ${p.comfyui.error}`);
  if (p.stability_matrix) L.push(`Stability Matrix models: ${p.stability_matrix.models_dir}`);
  if (p.checkpoints.length) {
    L.push('', 'Installed checkpoints:');
    for (const c of p.checkpoints) L.push(`  ${c.file}  ${c.base_model ? `[${c.base_model}]` : ''} ${c.tags.join(', ')}`);
  }
  L.push('', 'Capabilities:');
  const icon = { ready: '✅', missing: '❌', 'needs-nodes': '🧩', unknown: '?' };
  for (const [id, c] of Object.entries(p.capabilities)) {
    const why = c.status === 'ready' ? c.workflows.filter((w) => w.ok).map((w) => w.id + (w.tested ? '' : ' (untested)')).join(', ') : c.workflows.flatMap((w) => [...w.missing_models, ...w.missing_nodes.map((n) => `node ${n}`)]).slice(0, 3).join('; ') || c.note || '';
    L.push(`  ${icon[c.status] || '?'} ${id.padEnd(17)} ${c.status.padEnd(12)} ${why}`);
  }
  if (p.issues.length) {
    L.push('', 'Issues:');
    for (const i of p.issues) L.push(`  ${i.kind}: ${i.file} (${i.gb} GB) - finish or delete it in Stability Matrix`);
  }
  if (p.upgrades.length) {
    L.push('', 'Upgrade options (nothing is installed without your approval):');
    for (const u of p.upgrades) {
      const flags = [u.gated && !/gated/i.test(u.license) && 'gated - accept licence on Hugging Face', u.node_pack && `needs node pack ${u.node_pack}`, u.fits_vram === false && 'may not fit VRAM'].filter(Boolean);
      L.push(`  [${u.id}] ${u.title} - ${u.download_gb} GB - ${u.license}${flags.length ? ` (${flags.join('; ')})` : ''}`);
      L.push(`      ${u.why}`);
    }
  }
  return L.join('\n');
}
