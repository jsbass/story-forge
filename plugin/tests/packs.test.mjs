import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listPacks, installPack, removePack, installedPacks, ROLES, setSection, removeSection, topLevelBlocks, setupPlan } from '../tools/lib/packs.mjs';
import { scaffoldProject } from '../tools/lib/init.mjs';
import { moduleTypes } from '../tools/build/builder.mjs';
import { listWorkflows } from '../tools/assets/workflows.mjs';
import { loadCatalog } from '../tools/assets/assess.mjs';
import { PLUGIN_ROOT } from '../tools/lib/project.mjs';

const tmpProject = () => scaffoldProject(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-pack-')), 'game'), { title: 'Pack Test' });
const read = (root, f) => fs.readFileSync(path.join(root, f), 'utf8');

test('preset packs are well-formed: copy sources exist, role files name known roles', () => {
  const packs = listPacks();
  assert.deepEqual(packs.map((p) => p.id).sort(), ['comfyui', 'sugarcube']);
  for (const p of packs) {
    for (const from of Object.keys(p.copy)) assert.ok(fs.existsSync(path.join(p.dir, from)), `${p.id}: ${from}`);
    for (const f of fs.readdirSync(path.join(p.dir, 'roles'))) assert.ok(ROLES[path.basename(f, '.md')], `${p.id}: unknown role ${f}`);
  }
  assert.ok(setupPlan('sugarcube').some((s) => s.step === 'sugarcube-format'));
  assert.deepEqual(setupPlan('comfyui'), []);
});

test('the plugin has no engine or asset data outside presets/', () => {
  for (const d of ['engine', 'modules', 'workflows', 'examples']) assert.ok(!fs.existsSync(path.join(PLUGIN_ROOT, d)), d);
  assert.ok(!fs.existsSync(path.join(PLUGIN_ROOT, 'assets-catalog.json')));
});

test('playbook sections: set, replace and remove keep project notes', () => {
  let t = '# P\n\n## Project notes\n\nmine\n';
  t = setSection(t, 'a', 'one');
  t = setSection(t, 'b', 'two');
  t = setSection(t, 'a', 'ONE');
  assert.match(t, /mine[\s\S]*BEGIN -->\nONE\n[\s\S]*BEGIN -->\ntwo\n/);
  t = removeSection(t, 'a');
  assert.ok(!t.includes('ONE') && t.includes('two') && t.includes('mine'));
});

test('topLevelBlocks splits YAML and keeps leading comments with their block', () => {
  const b = topLevelBlocks('# head\na: 1\n  # inner\n  x: 2\n# about b\nb:\n  - 1\n');
  assert.deepEqual(b.map((x) => x.key), ['a', 'b']);
  assert.equal(b[0].text, '# head\na: 1\n  # inner\n  x: 2\n');
  assert.equal(b[1].text, '# about b\nb:\n  - 1\n');
});

test('a new project gets generic config only; packs add files, playbooks and settings', async () => {
  const root = tmpProject();
  assert.ok(!/^format:|^distribution:|^comfyui:|^runtime:/m.test(read(root, 'forge.yaml')), 'no engine/asset settings before packs');
  assert.match(read(root, 'forge.yaml'), /engine:\n {2}name: null/);

  const a = await installPack(root, 'comfyui', { log: () => {} });
  assert.deepEqual(a.config, ['comfyui']);
  assert.ok(fs.existsSync(path.join(root, 'forge/assets/catalog.json')));
  assert.ok(listWorkflows(root).get('sdxl-image')?.scope === 'pack');
  assert.ok(loadCatalog(root).models.length);
  for (const role of Object.keys(ROLES)) assert.ok(fs.existsSync(path.join(root, 'forge/roles', `${role}.md`)), role);
  assert.match(read(root, 'forge/roles/asset-generator.md'), /forge-pack:comfyui BEGIN/);

  const e = await installPack(root, 'sugarcube', { skipSetup: true, log: () => {} });
  assert.deepEqual(e.config, ['format', 'distribution', 'distribution_settings', 'optimize', 'performance', 'runtime']);
  const cfg = read(root, 'forge.yaml');
  assert.match(cfg, /# --- added by the sugarcube engine pack ---\nformat:\n {2}name: SugarCube/);
  assert.match(cfg, /single_html_max_mb: 25 {3}# the single-HTML target/);
  assert.deepEqual(moduleTypes(root), ['explore', 'inventory', 'minigame', 'stats']);
  assert.ok(fs.existsSync(path.join(root, 'forge/engine/runtime/core.js')));
  assert.match(read(root, 'forge/roles/game-builder.md'), /forge-pack:sugarcube BEGIN[\s\S]*SugarCube conventions/);
  assert.deepEqual(Object.keys(installedPacks(root)).sort(), ['comfyui', 'sugarcube']);

  // Re-install keeps the project's edits (unless --force) and doesn't duplicate config or sections.
  const core = path.join(root, 'forge/engine/runtime/core.js');
  fs.appendFileSync(core, '\n// project tweak\n');
  fs.appendFileSync(path.join(root, 'forge/roles/game-builder.md'), '\nAlways comment custom widgets.\n');
  const again = await installPack(root, 'sugarcube', { skipSetup: true, log: () => {} });
  assert.deepEqual(again.kept, ['forge/engine/runtime/core.js']);
  assert.deepEqual(again.config, []);
  assert.equal(read(root, 'forge/roles/game-builder.md').split('forge-pack:sugarcube BEGIN').length, 2);
  await installPack(root, 'sugarcube', { skipSetup: true, force: true, log: () => {} });
  assert.ok(!read(root, 'forge/engine/runtime/core.js').includes('project tweak'));

  // Removing a pack deletes its files and sections; project notes stay.
  assert.ok(removePack(root, 'sugarcube'));
  assert.ok(!fs.existsSync(path.join(root, 'forge/engine')));
  const gb = read(root, 'forge/roles/game-builder.md');
  assert.ok(!gb.includes('forge-pack:sugarcube') && gb.includes('Always comment custom widgets.'));
  assert.throws(() => moduleTypes(root), /No engine pack is installed yet: forge engine set/);
});

test('a project created inside another git repo gets its own repo; commits never go to the parent', async () => {
  const { git, isRepoRoot, commitAll } = await import('../tools/lib/git.mjs');
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-outer-'));
  git(outer, ['init', '-q']);
  const root = scaffoldProject(path.join(outer, 'example'), { title: 'Nested' });
  assert.ok(isRepoRoot(root));
  const loose = path.join(outer, 'loose');
  fs.mkdirSync(loose);
  assert.throws(() => commitAll(loose, 'x'), /not the root of its own git repository \(it is inside/);
});
