// YAML access. The 'yaml' package is installed into each game project by
// `forge setup` (run automatically by `forge new`), so the plugin itself has
// no install step. We resolve it from the project first, then the plugin.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readText, writeText } from './util.mjs';

let cached = null;

export function loadYamlLib(root) {
  if (cached) return cached;
  const candidates = [];
  if (root) candidates.push(path.join(root, 'package.json'));
  candidates.push(fileURLToPath(new URL('../../package.json', import.meta.url)));
  for (const c of candidates) {
    try {
      cached = createRequire(c)('yaml');
      return cached;
    } catch { /* try next */ }
  }
  throw new Error("The 'yaml' package isn't installed for this project. Run: node .forge/forge.mjs setup");
}

/** Parse a YAML (or .json) file. Returns null when the file doesn't exist. */
export function readYaml(file, root) {
  if (!fs.existsSync(file)) return null;
  const text = readText(file);
  if (file.endsWith('.json')) return JSON.parse(text);
  return loadYamlLib(root).parse(text) ?? null;
}

/**
 * Edit one top-level block of a YAML file (e.g. `art:` in forge.yaml) and leave every other line
 * byte-for-byte as it was. `edit(doc, lib)` gets a yaml Document holding just that block; use
 * doc.getIn / doc.setIn with paths starting at `key`. Missing blocks are appended.
 */
export function updateYamlBlock(file, root, key, edit) {
  const lib = loadYamlLib(root);
  const text = fs.existsSync(file) ? readText(file).replace(/\r\n/g, '\n') : '';
  const lines = text.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
  let end = start;
  if (start >= 0) {
    end = start + 1;
    while (end < lines.length && (lines[end] === '' || /^[\s#]/.test(lines[end]))) end++;
    while (end > start + 1 && lines[end - 1].trim() === '') end--; // keep blank lines before the next key
  }
  const block = start >= 0 ? lines.slice(start, end).join('\n') : `${key}: null`;
  const doc = lib.parseDocument(block);
  if (doc.errors?.length) throw new Error(`${path.basename(file)} (${key}): ${doc.errors[0].message}`);
  // A null/scalar block becomes a map when edited below it.
  const cur = doc.get(key, true);
  if (!cur || !lib.isMap(cur)) {
    const node = doc.createNode(lib.isScalar(cur) || cur == null ? {} : doc.get(key));
    if (cur?.comment) node.comment = cur.comment;
    doc.set(key, node);
  }
  edit(doc, lib);
  const out = doc.toString({ lineWidth: 0, flowCollectionPadding: false }).replace(/\n$/, '');
  const next = start >= 0 ? [...lines.slice(0, start), out, ...lines.slice(end)] : [...lines.filter((l, i) => !(i === lines.length - 1 && l === '')), out, ''];
  writeText(file, next.join('\n'));
}

export function writeYaml(file, data, root) {
  writeText(file, loadYamlLib(root).stringify(data, { lineWidth: 0 }));
}
