// Fine-grained artifact dependency graph for impact analysis.
// deps.json: { artifacts: { "<file>": { from: { "<upstream file>": "<hash at record time>" }, recordedAt } } }
import path from 'node:path';
import { readJson, writeJson, hashFile, toPosix } from './util.mjs';
import { projectPaths } from './project.mjs';

const norm = (p) => toPosix(p).replace(/^\.\//, '');

export function loadDeps(root) {
  return readJson(projectPaths(root).deps, { artifacts: {} });
}

export function saveDeps(root, d) {
  writeJson(projectPaths(root).deps, d);
}

/** Record that `artifact` was produced from `from` files (hashes captured now). */
export function recordDeps(root, d, artifact, from) {
  const entry = { from: {}, recordedAt: new Date().toISOString() };
  for (const f of from.map(norm)) entry.from[f] = hashFile(path.join(root, f));
  d.artifacts[norm(artifact)] = entry;
  return entry;
}

/** Artifacts whose upstream files changed since they were recorded. */
export function staleArtifacts(root, d) {
  const out = [];
  for (const [artifact, e] of Object.entries(d.artifacts)) {
    const changed = Object.entries(e.from)
      .filter(([f, h]) => hashFile(path.join(root, f)) !== h)
      .map(([f]) => f);
    if (changed.length) out.push({ artifact, changed });
  }
  return out;
}

/**
 * Everything downstream of the given files (transitively).
 * Folder inputs (e.g. "characters/") match any upstream file under them.
 */
export function impactOf(root, d, files) {
  const rev = new Map();
  for (const [artifact, e] of Object.entries(d.artifacts)) {
    for (const up of Object.keys(e.from)) {
      if (!rev.has(up)) rev.set(up, new Set());
      rev.get(up).add(artifact);
    }
  }
  const starts = files.map(norm);
  const matches = (up) => starts.some((s) => up === s || (s.endsWith('/') && up.startsWith(s)));
  const result = new Map();
  const queue = [];
  for (const up of rev.keys()) if (matches(up)) for (const a of rev.get(up)) queue.push([a, up, 1]);
  while (queue.length) {
    const [a, via, depth] = queue.shift();
    if (result.has(a)) continue;
    result.set(a, { artifact: a, via, depth });
    for (const next of rev.get(a) || []) queue.push([next, a, depth + 1]);
  }
  const stale = new Set(staleArtifacts(root, d).map((s) => s.artifact));
  return [...result.values()].map((r) => ({ ...r, stale: stale.has(r.artifact) })).sort((x, y) => x.depth - y.depth || x.artifact.localeCompare(y.artifact));
}
