// Model + node-pack installation into the Stability Matrix shared Models folder.
// Callers MUST have the user's explicit approval for each item before calling these.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { FORGE_HOME, loadCatalog, stabilityMatrixDir } from './assess.mjs';

function logInstall(entry) {
  fs.mkdirSync(FORGE_HOME, { recursive: true });
  fs.appendFileSync(path.join(FORGE_HOME, 'installs.log'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

async function sha256(file) {
  const h = crypto.createHash('sha256');
  await new Promise((res, rej) => fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', res).on('error', rej));
  return h.digest('hex');
}

/** Download with resume (.part file + Range) and optional SHA-256 check. */
export async function downloadFile(url, dest, { sha = null, headers = {}, onProgress } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = dest + '.part';
  const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  const res = await fetch(url, { headers: { 'User-Agent': 'twine-forge', ...(have ? { Range: `bytes=${have}-` } : {}), ...headers }, redirect: 'follow' });
  if (res.status === 401 || res.status === 403) {
    const e = new Error(`Download refused (HTTP ${res.status}). The model is gated or needs a login.`);
    e.code = 'AUTH';
    throw e;
  }
  if (!res.ok && res.status !== 206) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  const append = res.status === 206;
  const total = Number(res.headers.get('content-length') || 0) + (append ? have : 0);
  const out = fs.createWriteStream(part, { flags: append ? 'a' : 'w' });
  let done = append ? have : 0;
  let last = 0;
  for await (const chunk of res.body) {
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    done += chunk.length;
    if (onProgress && Date.now() - last > 2000) { last = Date.now(); onProgress(done, total); }
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  if (sha) {
    const got = await sha256(part);
    if (got.toLowerCase() !== sha.toLowerCase()) {
      fs.rmSync(part, { force: true });
      throw new Error(`Checksum mismatch for ${path.basename(dest)} (expected ${sha.slice(0, 12)}…, got ${got.slice(0, 12)}…). File removed.`);
    }
  }
  fs.renameSync(part, dest);
  return { dest, bytes: done };
}

/**
 * Install a catalog model (all its files) into Stability Matrix's Models folder.
 * Gated files are not downloaded; the result says what the user must do instead.
 */
export async function installCatalogModel(id, { log = console.log } = {}) {
  const catalog = loadCatalog();
  const m = catalog.models.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown catalog model '${id}'. Options: ${catalog.models.map((x) => x.id).join(', ')}`);
  const sm = stabilityMatrixDir();
  if (!sm) throw new Error('Stability Matrix library not found. Set FORGE_SM_DIR to its folder (the one containing Models/).');
  const results = [];
  for (const f of m.files) {
    const dest = path.join(sm, 'Models', f.sm_folder, f.filename);
    if (fs.existsSync(dest)) { results.push({ file: f.filename, status: 'already-installed' }); continue; }
    if (f.gated) {
      results.push({
        file: f.filename,
        status: 'manual',
        instructions: `Gated model. 1) Sign in to Hugging Face and accept the licence at ${f.gated_page}. 2) Download ${f.url} 3) Save it as ${dest}. Then run: forge assess`,
      });
      continue;
    }
    log(`Downloading ${f.filename} (~${f.approx_gb} GB) -> ${path.relative(sm, dest)}`);
    try {
      await downloadFile(f.url, dest, { sha: f.sha256, onProgress: (d, t) => log(`  ${(d / 1e9).toFixed(2)} / ${(t / 1e9).toFixed(2)} GB`) });
      logInstall({ model: id, file: f.filename, source: f.url, sha256: f.sha256 || null, dest, license: m.license });
      results.push({ file: f.filename, status: 'installed', dest });
    } catch (e) {
      results.push({ file: f.filename, status: e.code === 'AUTH' ? 'manual' : 'failed', error: e.message });
    }
  }
  return { id, results, node_pack: m.node_pack || null };
}

/**
 * Install a ComfyUI custom node pack by cloning it into ComfyUI's custom_nodes and
 * installing its requirements into ComfyUI's own Python venv. ComfyUI must be restarted afterwards.
 */
export function installNodePack({ repo, name }, comfyInstallDir, { log = console.log } = {}) {
  if (!comfyInstallDir) throw new Error('ComfyUI install folder unknown (is ComfyUI running? run forge assess)');
  const target = path.join(comfyInstallDir, 'custom_nodes', name);
  if (fs.existsSync(target)) return { status: 'already-installed', target };
  log(`git clone ${repo} -> ${target}`);
  execFileSync('git', ['clone', '--depth', '1', repo, target], { stdio: 'inherit' });
  const req = path.join(target, 'requirements.txt');
  if (fs.existsSync(req)) {
    const py = [path.join(comfyInstallDir, 'venv', 'Scripts', 'python.exe'), path.join(comfyInstallDir, 'venv', 'bin', 'python')].find((p) => fs.existsSync(p));
    if (py) {
      log(`${py} -m pip install -r requirements.txt`);
      execFileSync(py, ['-m', 'pip', 'install', '-r', req], { stdio: 'inherit' });
    } else log('No ComfyUI venv found - install requirements.txt manually.');
  }
  logInstall({ node_pack: name, repo, dest: target });
  return { status: 'installed', target, restart: 'Restart ComfyUI (Stability Matrix: Stop, then Launch) to load the new nodes.' };
}

// ---------- Civitai (art-direction checkpoints & LoRAs) ----------

const CIVITAI_TYPE_FOLDER = { Checkpoint: 'StableDiffusion', LORA: 'Lora', TextualInversion: 'Embeddings' };

/** Search Civitai's public API (no key needed for search). */
export async function civitaiSearch(query, { types = 'Checkpoint', baseModels = ['SDXL 1.0', 'Illustrious', 'Pony'], limit = 8 } = {}) {
  const q = new URLSearchParams({ query, types, sort: 'Most Downloaded', nsfw: 'false', limit: String(limit) });
  for (const b of baseModels) q.append('baseModels', b);
  const res = await fetch(`https://civitai.com/api/v1/models?${q}`, { headers: { 'User-Agent': 'twine-forge' } });
  if (!res.ok) throw new Error(`Civitai search failed: HTTP ${res.status}`);
  const j = await res.json();
  return (j.items || []).map((m) => {
    const v = m.modelVersions?.[0] || {};
    const file = (v.files || []).find((f) => f.primary) || v.files?.[0] || {};
    return {
      modelId: m.id, versionId: v.id, name: m.name, version: v.name, type: m.type, baseModel: v.baseModel,
      tags: (m.tags || []).slice(0, 8), downloads: m.stats?.downloadCount, file: file.name, gb: file.sizeKB ? +(file.sizeKB / 1e6).toFixed(2) : null,
      sha256: file.hashes?.SHA256, downloadUrl: file.downloadUrl, trainedWords: v.trainedWords || [],
      page: `https://civitai.com/models/${m.id}`, license: m.allowCommercialUse,
    };
  });
}

/** Install a Civitai model version into Stability Matrix, writing SM's .cm-info.json sidecar. */
export async function installCivitai(versionId, { log = console.log } = {}) {
  const sm = stabilityMatrixDir();
  if (!sm) throw new Error('Stability Matrix library not found. Set FORGE_SM_DIR.');
  const v = await (await fetch(`https://civitai.com/api/v1/model-versions/${versionId}`, { headers: { 'User-Agent': 'twine-forge' } })).json();
  if (!v?.id) throw new Error(`Civitai version ${versionId} not found`);
  const file = (v.files || []).find((f) => f.primary) || v.files?.[0];
  const type = v.model?.type || 'Checkpoint';
  const folder = CIVITAI_TYPE_FOLDER[type];
  if (!folder) throw new Error(`Unsupported Civitai model type '${type}'`);
  const dest = path.join(sm, 'Models', folder, file.name);
  const manual = `Open Stability Matrix > Model Browser > Civitai, search "${v.model?.name}", and download version "${v.name}". Then run: forge assess`;
  if (fs.existsSync(dest)) return { status: 'already-installed', dest };
  log(`Downloading ${file.name} (${(file.sizeKB / 1e6).toFixed(2)} GB) from Civitai -> ${path.relative(sm, dest)}`);
  try {
    await downloadFile(file.downloadUrl, dest, { sha: file.hashes?.SHA256, onProgress: (d, t) => log(`  ${(d / 1e9).toFixed(2)} / ${(t / 1e9).toFixed(2)} GB`) });
  } catch (e) {
    if (e.code === 'AUTH') return { status: 'manual', instructions: `Civitai requires sign-in for this file. ${manual}` };
    throw e;
  }
  // Same sidecar shape Stability Matrix writes for its own Civitai downloads.
  const sidecar = {
    ModelId: v.modelId, ModelName: v.model?.name, ModelDescription: null, Nsfw: !!v.model?.nsfw, Tags: [],
    ModelType: type, VersionId: v.id, VersionName: v.name, VersionDescription: null, BaseModel: v.baseModel,
    FileMetadata: { fp: file.metadata?.fp || null, size: file.metadata?.size || null, format: file.metadata?.format || null },
    ImportedAt: new Date().toISOString(), Hashes: { SHA256: file.hashes?.SHA256 || null, CRC32: file.hashes?.CRC32 || null, BLAKE3: file.hashes?.BLAKE3 || null },
    TrainedWords: v.trainedWords || [], Stats: null, UserTitle: null, ThumbnailImageUrl: null, InferenceDefaults: null, Source: 0,
  };
  fs.writeFileSync(dest.replace(/\.[^.]+$/, '.cm-info.json'), JSON.stringify(sidecar));
  logInstall({ civitai: v.id, model: v.model?.name, file: file.name, dest, sha256: file.hashes?.SHA256 });
  return { status: 'installed', dest, trainedWords: v.trainedWords || [] };
}
