// Style profiles: reusable house styles (prose, art, UI theme, audio) shared across games.
// Library: ~/.forge/styles/<name>/ (yours) and the plugin's styles/<name>/ (built-in examples).
// A profile holds any subset of: prose.md, art.yaml, ui.css, audio.yaml, plus profile.yaml (name, description).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readText, writeText } from './util.mjs';
import { PLUGIN_ROOT, loadProject } from './project.mjs';
import { readYaml, writeYaml, updateYamlBlock } from './yaml.mjs';

export const STYLE_PARTS = ['prose', 'art', 'ui', 'audio'];
const FILES = { prose: 'prose.md', art: 'art.yaml', ui: 'ui.css', audio: 'audio.yaml' };
/** Where each part lives inside a game project. */
export const PROJECT_FILES = { prose: 'design/style/prose.md', audio: 'design/style/audio.yaml', ui: 'src/custom/style.css', art: 'forge.yaml (art:)' };
const ART_KEYS = ['style', 'checkpoint', 'prompt_prefix', 'negative', 'defaults', 'palette'];

export function userStylesDir() {
  return path.join(process.env.FORGE_HOME || path.join(os.homedir(), '.forge'), 'styles');
}

function libraries() {
  return [
    { dir: userStylesDir(), builtin: false },
    { dir: path.join(PLUGIN_ROOT, 'styles'), builtin: true },
  ];
}

const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** The provenance line applyStyle adds at the top of prose.md / style.css. */
const STAMP_RE = /^(<!--|\/\*) Style profile '[^\n]*\n/;

function readProfile(dir, builtin, root) {
  const meta = readYaml(path.join(dir, 'profile.yaml'), root) || {};
  const parts = STYLE_PARTS.filter((p) => fs.existsSync(path.join(dir, FILES[p])));
  return { name: path.basename(dir), description: meta.description || '', saved_from: meta.saved_from || null, parts, builtin, dir };
}

/** All profiles; a profile in your library hides a built-in one with the same name. */
export function listStyles(root = null) {
  const seen = new Map();
  for (const lib of libraries()) {
    if (!fs.existsSync(lib.dir)) continue;
    for (const name of fs.readdirSync(lib.dir).sort()) {
      const dir = path.join(lib.dir, name);
      if (!NAME.test(name) || !fs.statSync(dir).isDirectory() || seen.has(name)) continue;
      seen.set(name, readProfile(dir, lib.builtin, root));
    }
  }
  return [...seen.values()];
}

export function getStyle(name, root = null) {
  const s = listStyles(root).find((x) => x.name === name);
  if (!s) throw new Error(`No style profile '${name}'. Available: ${listStyles(root).map((x) => x.name).join(', ') || 'none'}`);
  return s;
}

export function readPart(style, part, root = null) {
  const f = path.join(style.dir, FILES[part]);
  if (!fs.existsSync(f)) return null;
  return part === 'art' || part === 'audio' ? readYaml(f, root) : readText(f);
}

function parseParts(parts) {
  const list = parts?.length ? parts : STYLE_PARTS;
  const bad = list.filter((p) => !STYLE_PARTS.includes(p));
  if (bad.length) throw new Error(`Unknown part(s): ${bad.join(', ')}. Parts: ${STYLE_PARTS.join(', ')}`);
  return list;
}

/**
 * Apply (some parts of) a profile to a project. Applying several profiles with different parts combines them;
 * forge.yaml style_profile records which profile each part came from.
 * @returns {{applied: string[], skipped: string[], files: string[]}}
 */
export function applyStyle(root, name, { parts = null } = {}) {
  const style = getStyle(name, root);
  const wanted = parseParts(parts);
  const applied = [];
  const skipped = [];
  const files = [];
  const stamp = `Style profile '${name}' (forge style apply). Edit freely; save back with: forge style save <name>`;
  for (const part of wanted) {
    const value = readPart(style, part, root);
    if (value === null) { skipped.push(part); continue; }
    if (part === 'prose') {
      writeText(path.join(root, PROJECT_FILES.prose), `<!-- ${stamp} -->\n${value.replace(STAMP_RE, '')}`);
      files.push(PROJECT_FILES.prose);
    } else if (part === 'ui') {
      writeText(path.join(root, PROJECT_FILES.ui), `/* ${stamp} */\n${value.replace(STAMP_RE, '')}`);
      files.push(PROJECT_FILES.ui);
    } else if (part === 'audio') {
      writeYaml(path.join(root, PROJECT_FILES.audio), value, root);
      files.push(PROJECT_FILES.audio);
    } else if (part === 'art') {
      updateYamlBlock(path.join(root, 'forge.yaml'), root, 'art', (doc) => {
        for (const k of ART_KEYS) {
          // A profile's checkpoint is only a suggestion if it isn't installed here; null keeps the project's.
          if (value[k] === undefined || (k === 'checkpoint' && !value[k])) continue;
          doc.setIn(['art', k], value[k]);
        }
      });
      files.push('forge.yaml');
    }
    applied.push(part);
  }
  if (applied.length) {
    updateYamlBlock(path.join(root, 'forge.yaml'), root, 'style_profile', (doc) => {
      for (const p of applied) doc.setIn(['style_profile', p], name);
    });
  }
  return { applied, skipped, files: [...new Set(files)] };
}

/** Save the project's current style as a profile in ~/.forge/styles/<name>. */
export function saveStyle(root, name, { parts = null, description = '', force = false } = {}) {
  if (!NAME.test(name)) throw new Error('Profile names use lower-case letters, digits and dashes (e.g. storm-gothic)');
  const dir = path.join(userStylesDir(), name);
  if (fs.existsSync(dir) && !force) throw new Error(`Profile '${name}' already exists in ${dir}. Pass --force to overwrite it.`);
  const project = loadProject(root);
  const wanted = parseParts(parts);
  const saved = [];
  const missing = [];
  const out = {};
  for (const part of wanted) {
    if (part === 'art') {
      const art = project.config.art || {};
      const pick = Object.fromEntries(ART_KEYS.filter((k) => art[k] !== undefined && art[k] !== null && art[k] !== '').map((k) => [k, art[k]]));
      if (Object.keys(pick).length) out.art = pick; else missing.push('art');
    } else {
      const f = path.join(root, PROJECT_FILES[part]);
      if (fs.existsSync(f)) out[part] = readText(f); else missing.push(part);
    }
  }
  if (!Object.keys(out).length) throw new Error(`Nothing to save: none of ${wanted.join(', ')} exist in this project (${wanted.map((p) => PROJECT_FILES[p]).join(', ')})`);
  if (force) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [part, value] of Object.entries(out)) {
    if (part === 'art' || part === 'audio') writeYaml(path.join(dir, FILES[part]), typeof value === 'string' ? readYaml(path.join(root, PROJECT_FILES[part]), root) : value, root);
    else writeText(path.join(dir, FILES[part]), value.replace(STAMP_RE, ''));
    saved.push(part);
  }
  writeYaml(path.join(dir, 'profile.yaml'), { name, description, saved_from: project.config.title || null, at: new Date().toISOString().slice(0, 10) }, root);
  return { dir, saved, missing };
}
