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

export function writeYaml(file, data, root) {
  writeText(file, loadYamlLib(root).stringify(data, { lineWidth: 0 }));
}
