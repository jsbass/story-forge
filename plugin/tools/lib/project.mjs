// Locating and loading a Forge game project.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readYaml } from './yaml.mjs';
import { listFiles } from './util.mjs';

export const PLUGIN_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

/** Walk upwards from `start` to the folder containing forge.yaml. */
export function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'forge.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function requireProjectRoot(start) {
  const root = findProjectRoot(start);
  if (!root) throw new Error('Not inside a Forge project (no forge.yaml found). Create one with: forge new <dir>');
  return root;
}

export function projectPaths(root) {
  const p = (...s) => path.join(root, ...s);
  return {
    root,
    config: p('forge.yaml'),
    state: p('state'),
    pipeline: p('state', 'pipeline.json'),
    deps: p('state', 'deps.json'),
    feedback: p('state', 'feedback'),
    design: p('design'),
    interview: p('design', 'interview.md'),
    bible: p('design', 'story-bible.md'),
    branchMap: p('design', 'branch-map.yaml'),
    loopsDir: p('design', 'loops'),
    loops: p('design', 'loops', 'loops.yaml'),
    characters: p('characters'),
    script: p('script'),
    src: p('src'),
    build: p('build'),
    qa: p('qa'),
    vendor: p('vendor'),
    formatJs: p('vendor', 'sugarcube-2', 'format.js'),
    // forge/ holds this project's copies of plugin presets (installed by `forge pack install`).
    forgeDir: p('forge'),
    roles: p('forge', 'roles'),
    packsFile: p('forge', 'packs.json'),
    engineRuntime: p('forge', 'engine', 'runtime'),
    engineModules: p('forge', 'engine', 'modules'),
    assetCatalog: p('forge', 'assets', 'catalog.json'),
    assetWorkflows: p('forge', 'assets', 'workflows'),
    modelsLock: p('forge', 'assets', 'models.lock.json'),
  };
}

/** Load everything the build/QA tools need. YAML files are optional. */
export function loadProject(root) {
  const paths = projectPaths(root);
  const config = readYaml(paths.config, root) || {};
  const characters = listFiles(paths.characters, (f) => /\.ya?ml$/.test(f))
    .map((f) => ({ file: f, ...(readYaml(f, root) || {}) }))
    .filter((c) => c.id);
  const loops = readYaml(paths.loops, root) || { modules: [] };
  const branchMap = readYaml(paths.branchMap, root);
  return { root, paths, config, characters, loops, branchMap };
}
