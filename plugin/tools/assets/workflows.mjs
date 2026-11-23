// Workflow library: API-format ComfyUI graphs with named, typed parameters.
//
// Lookup order (first wins): <project>/assets/workflows (the project's own), ~/.forge/comfy-library (shared),
// <project>/forge/assets/workflows (copied from the comfyui asset pack). Outside a project the plugin's
// preset pack is read, so `forge assess` works before a project exists.
//
// File format (<id>.json):
// {
//   "id": "sdxl-image", "version": 1, "capability": "image", "kinds": ["bg","portrait","ui"],
//   "status": "tested" | "untested", "description": "...",
//   "params":  { "<name>": { "node": "3", "input": "seed", "default": 0, "model_folder"?: "checkpoints" } },
//   "outputs": { "type": "image" | "audio" | "video", "ext": "png" },
//   "requires": { "node_pack"?: "ComfyUI_IPAdapter_plus" },
//   "graph":   { "<node id>": { "class_type": "...", "inputs": { ... } } }
// }
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLUGIN_ROOT, projectPaths } from '../lib/project.mjs';
import { readJson, writeJson } from '../lib/util.mjs';

export const SHARED_LIBRARY = path.join(os.homedir(), '.forge', 'comfy-library');

export function libraryDirs(root) {
  return [
    root && { scope: 'project', dir: path.join(root, 'assets', 'workflows') },
    { scope: 'shared', dir: SHARED_LIBRARY },
    root && { scope: 'pack', dir: projectPaths(root).assetWorkflows },
    !root && { scope: 'preset', dir: path.join(PLUGIN_ROOT, 'presets', 'assets', 'comfyui', 'workflows') },
  ].filter(Boolean);
}

/** All workflows visible to a project, keyed by id (higher-priority scopes shadow lower). */
export function listWorkflows(root) {
  const out = new Map();
  for (const { scope, dir } of libraryDirs(root)) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
      const wf = readJson(path.join(dir, f));
      if (!wf?.id || !wf.graph) continue;
      if (!out.has(wf.id)) out.set(wf.id, { ...wf, scope, file: path.join(dir, f) });
    }
  }
  return out;
}

/** Resolve "id" or "id@version". Version mismatch is an error so assets stay reproducible. */
export function getWorkflow(root, ref) {
  const [id, ver] = String(ref).split('@');
  const wf = listWorkflows(root).get(id);
  if (!wf) throw new Error(`Unknown workflow '${id}'. Available: ${[...listWorkflows(root).keys()].join(', ')}`);
  if (ver && Number(ver) !== wf.version) throw new Error(`Workflow ${id} is v${wf.version}, but v${ver} was requested`);
  return wf;
}

export const ref = (wf) => `${wf.id}@${wf.version}`;

/** Fill parameters into a copy of the graph. Unknown params are an error. */
export function bindWorkflow(wf, values = {}) {
  const graph = structuredClone(wf.graph);
  const resolved = {};
  for (const [name, p] of Object.entries(wf.params || {})) {
    const v = values[name] !== undefined && values[name] !== null ? values[name] : p.default;
    if (v === undefined) continue;
    resolved[name] = v;
    const node = graph[p.node];
    if (!node) throw new Error(`Workflow ${wf.id}: param '${name}' points at missing node ${p.node}`);
    node.inputs[p.input] = v;
  }
  for (const k of Object.keys(values)) {
    if (!(k in (wf.params || {})) && values[k] !== undefined) throw new Error(`Workflow ${wf.id} has no parameter '${k}'. Parameters: ${Object.keys(wf.params || {}).join(', ')}`);
  }
  return { graph, values: resolved };
}

/**
 * Check a workflow against a live ComfyUI: node classes exist, model files exist.
 * @param comfy  Comfy client
 * @param values param values to check (defaults used otherwise)
 * @returns {Promise<{ok:boolean, missingNodes:string[], missingModels:{folder,file,param}[]}>}
 */
export async function validateWorkflow(comfy, wf, values = {}) {
  const info = await comfy.objectInfo();
  const classes = new Set(Object.values(wf.graph).map((n) => n.class_type));
  const missingNodes = [...classes].filter((c) => !info[c]);
  const missingModels = [];
  for (const [name, p] of Object.entries(wf.params || {})) {
    if (!p.model_folder) continue;
    const file = values[name] ?? p.default;
    const available = await comfy.models(p.model_folder);
    if (p.any_model && !file) {
      if (!available.length) missingModels.push({ folder: p.model_folder, file: '(any)', param: name });
    } else if (!available.includes(file)) {
      missingModels.push({ folder: p.model_folder, file, param: name });
    }
  }
  return { ok: !missingNodes.length && !missingModels.length, missingNodes, missingModels };
}

/** Save a workflow into the project library (bumping the version if the graph changed). */
export function saveProjectWorkflow(root, wf) {
  const dir = path.join(root, 'assets', 'workflows');
  const file = path.join(dir, `${wf.id}.json`);
  const prev = readJson(file);
  const changed = !prev || JSON.stringify(prev.graph) !== JSON.stringify(wf.graph) || JSON.stringify(prev.params) !== JSON.stringify(wf.params);
  const version = prev ? (changed ? prev.version + 1 : prev.version) : wf.version || 1;
  const { scope, file: _f, ...clean } = wf;
  writeJson(file, { ...clean, version });
  return { file, version };
}

/** Copy a project workflow into the shared library used by all projects. */
export function promoteWorkflow(root, id) {
  const src = path.join(root, 'assets', 'workflows', `${id}.json`);
  if (!fs.existsSync(src)) throw new Error(`No project workflow '${id}' in assets/workflows/`);
  fs.mkdirSync(SHARED_LIBRARY, { recursive: true });
  const dest = path.join(SHARED_LIBRARY, `${id}.json`);
  fs.copyFileSync(src, dest);
  return dest;
}
