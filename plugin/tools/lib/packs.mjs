// Preset packs: tool-specific instructions and data that a project copies in on demand.
//
//   plugin/presets/<group>/<id>/pack.json   the pack definition
//   plugin/presets/<group>/<id>/roles/*.md  playbook sections for the role agents
//
// `forge pack install <id>` copies the pack's files into the project (forge/...), merges its
// role sections into forge/roles/<role>.md, records it in forge/packs.json and runs its setup
// steps (npm packages, browsers, engine downloads) inside the project. The plugin's agents are
// generic and read forge/roles/<role>.md for the project-specific part of their job.
//
// pack.json:
// { "id": "sugarcube", "kind": "engine" | "assets", "version": 1, "label": "...", "description": "...",
//   "copy": { "<path in pack>": "<path in project>" },
//   "setup": [ { "step": "npm" | "playwright-chromium" | "sugarcube-format", "why": "...", "approx_mb": 150, ... } ] }
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT, projectPaths } from './project.mjs';
import { readJson, writeJson, readText, writeText, listFiles, rel } from './util.mjs';

export const PRESETS_DIR = path.join(PLUGIN_ROOT, 'presets');

/** Every role that reads a playbook: the plugin's agents plus the main-session skills. */
export const ROLES = {
  orchestrator: 'Orchestrator (main session)',
  'story-planner': 'Story Planner',
  'character-designer': 'Character Designer',
  'engine-advisor': 'Engine Advisor',
  'loop-designer': 'Game Loop Designer',
  'dialog-writer': 'Dialog Writer',
  'art-direction': 'Art Direction (main session)',
  'asset-generator': 'Asset Generator',
  'game-builder': 'Game Builder',
  'perf-optimizer': 'Performance Optimizer',
  'qa-functional': 'Functionality QA',
  'qa-character': 'Character QA',
  'qa-performance': 'Performance QA',
  'game-packager': 'Packager',
};

/** All packs the plugin offers. */
export function listPacks() {
  if (!fs.existsSync(PRESETS_DIR)) return [];
  return listFiles(PRESETS_DIR, (f) => path.basename(f) === 'pack.json')
    .map((f) => ({ ...readJson(f), dir: path.dirname(f) }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

export function getPack(id) {
  const p = listPacks().find((x) => x.id === id);
  if (!p) throw new Error(`Unknown preset pack '${id}'. Available: ${listPacks().map((x) => x.id).join(', ')}`);
  return p;
}

/** forge/packs.json: { <id>: { kind, version, label, installed_at, files } } */
export function installedPacks(root) {
  return readJson(projectPaths(root).packsFile, {});
}

export function installedPack(root, kind) {
  const e = Object.entries(installedPacks(root)).find(([, v]) => v.kind === kind);
  return e ? { id: e[0], ...e[1] } : null;
}

/** Throw a clear error when a project needs a pack that isn't installed. */
export function requirePackFile(root, file, kind, hint) {
  if (fs.existsSync(file)) return file;
  const have = installedPack(root, kind);
  throw new Error(`${rel(root, file)} is missing. ${have ? `Re-install the ${kind} pack: forge pack install ${have.id} --force` : `No ${kind} pack is installed yet: ${hint}`}`);
}

// ---------- role playbooks ----------

const BEGIN = (id) => `<!-- forge-pack:${id} BEGIN -->`;
const END = (id) => `<!-- forge-pack:${id} END -->`;

function roleStub(role) {
  return readText(path.join(PLUGIN_ROOT, 'templates', 'role-playbook.md'))
    .replace(/\{\{role\}\}/g, role)
    .replace(/\{\{title\}\}/g, ROLES[role] || role);
}

/** Create forge/roles/<role>.md for every role that doesn't have one yet. */
export function writeRoleStubs(root) {
  const dir = projectPaths(root).roles;
  const made = [];
  for (const role of Object.keys(ROLES)) {
    const f = path.join(dir, `${role}.md`);
    if (fs.existsSync(f)) continue;
    writeText(f, roleStub(role));
    made.push(rel(root, f));
  }
  return made;
}

export function hasSection(text, id) {
  return text.includes(BEGIN(id));
}

/** Replace (or append) a pack's managed section in a playbook. */
export function setSection(text, id, body) {
  const block = `${BEGIN(id)}\n${body.trim()}\n${END(id)}`;
  if (hasSection(text, id)) {
    const s = text.indexOf(BEGIN(id));
    const e = text.indexOf(END(id), s);
    return text.slice(0, s) + block + text.slice(e + END(id).length);
  }
  return `${text.replace(/\s*$/, '')}\n\n${block}\n`;
}

export function removeSection(text, id) {
  if (!hasSection(text, id)) return text;
  const s = text.indexOf(BEGIN(id));
  const e = text.indexOf(END(id), s);
  return (text.slice(0, s).replace(/\s*$/, '') + '\n' + text.slice(e + END(id).length).replace(/^\s*/, '\n')).replace(/\n{3,}/g, '\n\n');
}

// ---------- install / remove ----------

function sameFile(a, b) {
  return fs.existsSync(b) && fs.readFileSync(a).equals(fs.readFileSync(b));
}

/**
 * Copy a pack into a project. Files the project has edited are kept unless `force`.
 * @returns {{id, copied:string[], kept:string[], roles:string[], setup:object[]}}
 */
export async function installPack(root, id, { force = false, skipSetup = false, setupOptions = {}, log = console.log } = {}) {
  const pack = getPack(id);
  const installed = installedPacks(root);
  // One engine per project: swapping engines removes the old engine's files and role sections.
  const removed = [];
  for (const [oid, o] of Object.entries(installed)) {
    if (oid !== id && o.kind === pack.kind && pack.kind === 'engine') { removePack(root, oid); removed.push(oid); }
  }

  const copied = [];
  const kept = [];
  for (const [from, to] of Object.entries(pack.copy || {})) {
    const src = path.join(pack.dir, from);
    if (!fs.existsSync(src)) throw new Error(`Pack ${id}: '${from}' not found in ${pack.dir}`);
    const isDir = fs.statSync(src).isDirectory();
    for (const f of isDir ? listFiles(src) : [src]) {
      const dest = path.join(root, to, isDir ? path.relative(src, f) : '');
      if (fs.existsSync(dest) && !sameFile(f, dest) && !force && installed[id]) { kept.push(rel(root, dest)); continue; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(f, dest);
      copied.push(rel(root, dest));
    }
  }

  const config = mergeConfig(root, pack);
  writeRoleStubs(root);
  const roles = [];
  for (const f of listFiles(path.join(pack.dir, 'roles'), (x) => x.endsWith('.md'))) {
    const role = path.basename(f, '.md');
    const file = path.join(projectPaths(root).roles, `${role}.md`);
    const text = fs.existsSync(file) ? readText(file) : roleStub(role);
    if (hasSection(text, id) && !force) continue;
    writeText(file, setSection(text, id, readText(f)));
    roles.push(rel(root, file));
  }

  const latest = installedPacks(root);
  latest[id] = { kind: pack.kind, version: pack.version, label: pack.label, installed_at: new Date().toISOString(), files: Object.values(pack.copy || {}) };
  writeJson(projectPaths(root).packsFile, latest);

  const setup = skipSetup ? [] : await runSetup(root, pack, { ...setupOptions, log });
  return { id, kind: pack.kind, copied, kept, roles, removed, config, setup };
}

/** Split a YAML file into its top-level blocks (column-0 comments go with the block after them). */
export function topLevelBlocks(text) {
  const blocks = [];
  let pending = [];
  let cur = null;
  for (const line of text.replace(/\n+$/, '').split('\n')) {
    const m = /^([A-Za-z_][\w-]*):/.exec(line);
    if (m) {
      cur = { key: m[1], lines: [...pending, line] };
      blocks.push(cur);
      pending = [];
    } else if (/^#/.test(line) || (!cur && !line.trim())) pending.push(line);
    else if (cur) cur.lines.push(line);
  }
  return blocks.map((b) => ({ key: b.key, text: `${b.lines.join('\n').replace(/\s+$/, '')}\n` }));
}

/** Append the pack's forge.yaml blocks (presets/.../config.yaml) the project doesn't have yet. Comments are kept. */
export function mergeConfig(root, pack) {
  const src = path.join(pack.dir, 'config.yaml');
  const cfgFile = projectPaths(root).config;
  if (!fs.existsSync(src) || !fs.existsSync(cfgFile)) return [];
  let cfg = readText(cfgFile);
  const added = [];
  for (const b of topLevelBlocks(readText(src))) {
    if (new RegExp(`^${b.key}:`, 'm').test(cfg)) continue;
    cfg = `${cfg.replace(/\s*$/, '')}\n${b.text}`;
    added.push(b.key);
  }
  if (added.length) writeText(cfgFile, cfg);
  return added;
}

/** Remove a pack's copied folders and its role sections (project notes outside the markers stay). */
export function removePack(root, id) {
  const installed = installedPacks(root);
  const entry = installed[id];
  if (!entry) return false;
  for (const to of entry.files || []) {
    fs.rmSync(path.join(root, to), { recursive: true, force: true });
    // Tidy now-empty parent folders inside forge/.
    for (let d = path.dirname(path.join(root, to)); d.startsWith(projectPaths(root).forgeDir + path.sep); d = path.dirname(d)) {
      if (fs.existsSync(d) && !fs.readdirSync(d).length) fs.rmdirSync(d); else break;
    }
  }
  for (const f of listFiles(projectPaths(root).roles, (x) => x.endsWith('.md'))) {
    const text = readText(f);
    if (hasSection(text, id)) writeText(f, removeSection(text, id));
  }
  delete installed[id];
  writeJson(projectPaths(root).packsFile, installed);
  return true;
}

/** What `installPack` would download, for the approval message. */
export function setupPlan(id) {
  return (getPack(id).setup || []).map((s) => ({ step: s.step, why: s.why, approx_mb: s.approx_mb ?? null, packages: s.packages }));
}

async function runSetup(root, pack, { log, skipBrowsers = false, sugarcube = null }) {
  // Lazy import: init.mjs imports this module too.
  const { runCommand, installSugarCubeFormat } = await import('./init.mjs');
  const done = [];
  for (const s of pack.setup || []) {
    if (s.step === 'npm') {
      runCommand('npm', ['install', '--save-dev', '--no-audit', '--no-fund', ...s.packages], root, log);
    } else if (s.step === 'playwright-chromium') {
      if (skipBrowsers) { done.push({ step: s.step, skipped: true }); continue; }
      runCommand('npx', ['playwright', 'install', 'chromium'], root, log);
    } else if (s.step === 'sugarcube-format') {
      const version = await installSugarCubeFormat(root, { from: sugarcube, log });
      done.push({ step: s.step, version });
      continue;
    } else {
      throw new Error(`Pack ${pack.id}: unknown setup step '${s.step}'`);
    }
    done.push({ step: s.step });
  }
  return done;
}
