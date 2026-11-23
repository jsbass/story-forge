// Asset manifest: assets/manifest.yaml - every media asset the game needs, how it is
// (or will be) generated, its candidates, and which one is approved.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from '../lib/util.mjs';
import { readYaml, writeYaml } from '../lib/yaml.mjs';
import { compileScripts } from '../build/builder.mjs';

export const KIND_CAPABILITY = { bg: 'image', portrait: 'image', ui: 'image', sfx: 'sfx', ambience: 'sfx', music: 'music', video: 'video', voice: 'tts' };

/** Default workflow + params per asset kind. Projects override via forge.yaml art.defaults.<kind>. */
export const KIND_DEFAULTS = {
  bg: { workflow: 'sdxl-image', params: { width: 1344, height: 768 } },
  portrait: { workflow: 'sdxl-image', params: { width: 832, height: 1216 } },
  ui: { workflow: 'sdxl-image', params: { width: 1024, height: 1024 } },
  sfx: { workflow: 'stable-audio3-sfx', params: { seconds: 4 } },
  ambience: { workflow: 'stable-audio3-sfx', params: { seconds: 12 } },
  music: { workflow: 'ace15-music', params: { seconds: 60, duration: 60 } },
  video: { workflow: 'wan22-video', params: {} },
  voice: { workflow: null, params: {} },
};

export const STATUSES = ['requested', 'blocked_capability', 'generated', 'approved', 'rejected'];

export function manifestPath(root) {
  return path.join(root, 'assets', 'manifest.yaml');
}

export function loadManifest(root) {
  return readYaml(manifestPath(root), root) || { assets: [] };
}

export function saveManifest(root, m) {
  m.assets.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  writeYaml(manifestPath(root), m, root);
}

export function capabilitiesPath(root) {
  return path.join(root, 'state', 'capabilities.json');
}

export function loadCapabilities(root) {
  return readJson(capabilitiesPath(root));
}

/** Asset id for a media directive. Portraits are "<character>.<expression>". */
export function assetIdFor(kind, args) {
  if (kind === 'portrait') return `${args[0]}.${args[1] || 'neutral'}`;
  return args[0];
}

export const key = (a) => `${a.kind}:${a.id}`;

/**
 * Bring the manifest in line with the scripts: add newly referenced assets, record where
 * each is used, flag ones no longer referenced, and add one reference portrait per speaking character.
 */
export function syncManifest(root, project, { capabilities = null } = {}) {
  const m = loadManifest(root);
  const byKey = new Map(m.assets.map((a) => [key(a), a]));
  const { results, errors } = compileScripts(project);
  if (errors.length) throw new Error(`Fix script errors first (forge compile): ${errors.length} error(s)`);

  const used = new Map();
  const note = (kind, id, passage, extra = {}) => {
    const k = `${kind}:${id}`;
    if (!used.has(k)) used.set(k, { kind, id, sources: new Set(), ...extra });
    used.get(k).sources.add(passage);
  };
  for (const r of results) {
    for (const ref of r.refs.media) {
      if ((ref.kind === 'music' || ref.kind === 'ambience') && ref.args[0] === 'none') continue;
      const id = assetIdFor(ref.kind, ref.args);
      note(ref.kind, id, ref.passage, ref.kind === 'portrait' ? { character: ref.args[0], expression: ref.args[1] || 'neutral' } : {});
    }
    for (const line of r.refs.lines) used.has(`portrait:${line.speaker}.ref`) || note('portrait', `${line.speaker}.ref`, line.passage, { character: line.speaker, expression: 'reference', reference: true });
  }

  const added = [];
  const art = project.config.art || {};
  for (const [k, u] of used) {
    let a = byKey.get(k);
    if (!a) {
      const d = { ...KIND_DEFAULTS[u.kind], ...(art.defaults?.[u.kind] || {}) };
      a = {
        id: u.id,
        kind: u.kind,
        status: 'requested',
        ...(u.character ? { character: u.character, expression: u.expression } : {}),
        ...(u.reference ? { reference: true } : {}),
        prompt: null,
        negative: null,
        workflow: d.workflow,
        params: { ...(d.params || {}) },
        sources: [],
        candidates: [],
        approved: null,
        notes: [],
      };
      m.assets.push(a);
      byKey.set(k, a);
      added.push(k);
    }
    a.sources = [...u.sources].sort();
    delete a.unused;
  }
  const unused = [];
  for (const a of m.assets) if (!used.has(key(a))) { a.unused = true; unused.push(key(a)); }
  const changes = capabilities ? applyCapabilities(m, capabilities) : { blocked: [], unblocked: [], switched: [] };
  saveManifest(root, m);
  return { added, unused, ...changes, total: m.assets.length };
}

/** Mark assets whose capability is unavailable as blocked; unblock ones that became available. */
export function applyCapabilities(m, profile) {
  const blocked = [];
  const unblocked = [];
  const switched = [];
  for (const a of m.assets) {
    const cap = KIND_CAPABILITY[a.kind];
    const c = profile.capabilities?.[cap];
    const ready = c?.status === 'ready';
    // If the asset's workflow belongs to this capability but can't run here, move it to one that can.
    if (ready && !['approved', 'generated'].includes(a.status)) {
      const known = (c.workflows || []).find((w) => w.id === (a.workflow || '').split('@')[0]);
      const runnable = (c.workflows || []).find((w) => w.ok);
      if (known && !known.ok && runnable) {
        switched.push(`${key(a)}: ${a.workflow} -> ${runnable.id}`);
        a.workflow = runnable.id;
      }
    }
    if (!ready && a.status === 'requested') { a.status = 'blocked_capability'; blocked.push(key(a)); }
    if (ready && a.status === 'blocked_capability') { a.status = 'requested'; unblocked.push(key(a)); }
  }
  return { blocked, unblocked, switched };
}

/** After a capability upgrade: which assets are newly possible, and which could be improved. */
export function upgradeReport(m, before, after) {
  const newlyReady = Object.keys(after.capabilities || {}).filter((c) => after.capabilities[c].status === 'ready' && before?.capabilities?.[c]?.status !== 'ready');
  const unblocked = m.assets.filter((a) => a.status === 'blocked_capability' && newlyReady.includes(KIND_CAPABILITY[a.kind])).map(key);
  const improvable = [];
  if (newlyReady.includes('char_consistency')) {
    improvable.push(...m.assets.filter((a) => a.kind === 'portrait' && !a.reference && ['generated', 'approved'].includes(a.status) && !(a.workflow || '').includes('ipadapter')).map(key));
  }
  if (newlyReady.includes('upscale')) {
    improvable.push(...m.assets.filter((a) => a.kind === 'bg' && ['generated', 'approved'].includes(a.status) && a.workflow === 'sdxl-image').map(key));
  }
  return { newlyReady, unblocked, improvable };
}

export function findAsset(m, id) {
  const [kind, rest] = id.includes(':') ? id.split(':') : [null, id];
  const hits = m.assets.filter((a) => a.id === rest && (!kind || a.kind === kind));
  if (!hits.length) throw new Error(`No asset '${id}'. Run: forge assets list`);
  if (hits.length > 1) throw new Error(`'${id}' is ambiguous (${hits.map(key).join(', ')}); use kind:id`);
  return hits[0];
}

/** Approve a candidate: copy it to assets/final/<kind>/<id>.<ext>. */
export function approveAsset(root, m, id, candidate = null) {
  const a = findAsset(m, id);
  if (!a.candidates.length) throw new Error(`${key(a)} has no candidates yet`);
  const idx = candidate === null ? a.candidates.length - 1 : Number(candidate);
  const c = a.candidates[idx];
  if (!c) throw new Error(`${key(a)} has no candidate #${idx} (0..${a.candidates.length - 1})`);
  const src = path.join(root, c.file);
  if (!fs.existsSync(src)) throw new Error(`Candidate file missing: ${c.file}`);
  const ext = path.extname(c.file);
  const finalRel = `assets/final/${a.kind}/${a.id}${ext}`;
  const finalAbs = path.join(root, finalRel);
  fs.mkdirSync(path.dirname(finalAbs), { recursive: true });
  for (const old of fs.readdirSync(path.dirname(finalAbs)).filter((f) => f.startsWith(a.id + '.') && f !== path.basename(finalAbs))) fs.rmSync(path.join(path.dirname(finalAbs), old));
  fs.copyFileSync(src, finalAbs);
  a.status = 'approved';
  a.approved = { candidate: idx, file: finalRel, seed: c.seed, workflow: c.workflow, at: new Date().toISOString() };
  return a;
}

export function rejectAsset(m, id, note) {
  const a = findAsset(m, id);
  a.status = 'rejected';
  if (note) a.notes.push({ at: new Date().toISOString(), note });
  return a;
}

/** Final assets that exist on disk, keyed "kind:id" -> project-relative path. */
export function finalAssets(root, m) {
  const out = {};
  for (const a of m.assets) {
    if (a.approved?.file && fs.existsSync(path.join(root, a.approved.file))) out[key(a)] = a.approved.file;
  }
  return out;
}

export function summarizeManifest(m) {
  const s = { total: 0, byStatus: {}, byKind: {} };
  for (const a of m.assets) {
    if (a.unused) continue;
    s.total++;
    s.byStatus[a.status] = (s.byStatus[a.status] || 0) + 1;
    s.byKind[a.kind] = (s.byKind[a.kind] || 0) + 1;
  }
  return s;
}

export function writeCapabilities(root, profile) {
  writeJson(capabilitiesPath(root), profile);
}
