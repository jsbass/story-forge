import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as inventory from '../presets/engines/sugarcube/modules/inventory/module.mjs';
import * as minigame from '../presets/engines/sugarcube/modules/minigame/module.mjs';
import * as explore from '../presets/engines/sugarcube/modules/explore/module.mjs';
import { extractRefs, analyzeStatic } from '../tools/qa/static.mjs';
import { fitReport, engineFor, loadEngineCatalog } from '../tools/engines/index.mjs';
import { loadYamlLib } from '../tools/lib/yaml.mjs';

// Tests that read/write YAML need the 'yaml' package, which lives in game projects, not the plugin.
// Point FORGE_TEST_PROJECT at a project (after `forge setup`) to run them.
let yamlOk = false;
try { loadYamlLib(process.env.FORGE_TEST_PROJECT || null); yamlOk = true; } catch { /* skipped */ }
const needsYaml = { skip: yamlOk ? false : 'set FORGE_TEST_PROJECT to a set-up game project to run YAML tests' };

const P = (name, text, tags = []) => ({ name, text, tags });

const INV = {
  capacity: 3,
  start: ['rope'],
  items: [{ id: 'rope' }, { id: 'hook' }, { id: 'grapple', label: 'Grappling line' }],
  recipes: [{ use: ['rope', 'hook'], makes: 'grapple' }],
};

test('inventory: validation, variables, invariants', () => {
  assert.deepEqual(inventory.validate(INV), []);
  assert.match(inventory.validate({ items: [{ id: 'a' }], start: ['b'] }).join(), /start item 'b'/);
  assert.match(inventory.validate({ items: [{ id: 'a' }], recipes: [{ use: ['a'], makes: 'a' }] }).join(), /exactly two/);
  assert.match(inventory.validate({ items: [{ id: 'a' }, { id: 'a' }] }).join(), /listed twice/);
  assert.deepEqual(inventory.variables(INV), [{ name: 'inv', init: ['rope'] }]);
  assert.deepEqual(inventory.invariants(INV), [{ var: 'inv', allowed: ['rope', 'hook', 'grapple'], maxItems: 3, module: 'inventory' }]);
});

test('inventory lint catches unknown items and impossible combines', () => {
  const errs = inventory.lint(INV, [
    P('a', '<<give "hook">> <<take "rope">> <<combine "rope" "hook">> ?? if $inv.includes("rope")'),
    P('b', '<<give "sword">>'),
    P('c', '<<combine "rope" "grapple">>'),
    P('d', '<<if $inv.includes("map")>>x<</if>>'),
  ]);
  assert.deepEqual(errs.map((e) => e.passage), ['b', 'c', 'd']);
  assert.match(errs[1].message, /no recipe/);
});

test('minigame: validation, lint and declared links', () => {
  assert.deepEqual(minigame.validate({ locks: [{ id: 'vault', code: 1847 }] }), []);
  assert.match(minigame.validate({ locks: [{ id: 'v' }] }).join(), /needs a code/);
  assert.match(minigame.validate({ dice: 1 }).join(), /dice/);
  assert.equal(minigame.normalize({ locks: [{ id: 'v', code: 12 }] }).locks[0].code, '12');
  const errs = minigame.lint({ locks: [{ id: 'vault', code: '1' }] }, [
    P('ok', '<<skill_check "Climb" "grit" 12 "top" "fall">> <<codelock "vault" "in" "out">>'),
    P('bad1', '<<codelock "safe" "in" "out">>'),
    P('bad2', '<<skill_check "Climb" "grit" "top" "fall">>'),
    P('bad3', '<<skill_check "Climb" "grit" "hard" "top" "fall">>'),
  ]);
  assert.deepEqual(errs.map((e) => e.passage), ['bad1', 'bad2', 'bad3']);
  assert.deepEqual(minigame.links(), [{ macro: 'skill_check', args: [3, 4] }, { macro: 'codelock', args: [1, 2] }]);
});

const EXP = {
  time: { var: 'hours', start: 6, expire: 'night' },
  locations: [{ id: 'shore', passage: 'shore', cost: 1 }, { id: 'cave', passage: 'cave', cost: 2, requires: '$inv.includes("grapple")' }],
};

test('explore: validation, variables, links and lint', () => {
  assert.deepEqual(explore.validate(EXP), []);
  assert.match(explore.validate({}).join(), /give params.time/);
  assert.match(explore.validate({ time: { var: 'h', start: 0 } }).join(), /start must be > 0.*expire/);
  assert.deepEqual(explore.variables(EXP), [{ name: 'hours', init: 6 }]);
  assert.deepEqual(explore.invariants(EXP), [{ var: 'hours', min: 0, max: 6, module: 'explore' }]);
  assert.deepEqual(explore.links(EXP).flatMap((l) => l.targets), ['shore', 'cave', 'night', 'night']);
  const errs = explore.lint(EXP, [P('hub', '<<map_menu>> <<spend 1>> <<spend $x>> <<spend lots>>'), P('shore', ''), P('night', '')]);
  assert.equal(errs.length, 2);
  assert.match(errs[0].message, /missing passage 'cave'/);
  assert.match(errs[1].message, /<<spend lots>>/);
  assert.match(explore.lint({ locations: [{ id: 'a', passage: 'a' }] }, [P('a', '<<spend 1>>')])[0].message, /no time budget/);
});

test('static analysis follows loop-module links', () => {
  const moduleLinks = [...minigame.links(), ...explore.links(EXP)];
  const refs = extractRefs('<<skill_check "Climb \\"high\\"" "grit" 12 "top" \'fall\'>>', moduleLinks);
  assert.deepEqual(refs.map((r) => r.to), ['top', 'fall']);
  const passages = [
    P('hub', '<<map_menu>>'),
    P('shore', '<<link "Back" "hub">><</link>>'),
    P('cave', '<<skill_check "Climb" "grit" 10 "top" "hub">>'),
    P('top', 'win', ['ending']),
    P('night', 'lost', ['ending']),
  ];
  const withLinks = analyzeStatic({ passages, start: 'hub', moduleLinks });
  assert.deepEqual(withLinks.findings, [], JSON.stringify(withLinks.findings));
  const without = analyzeStatic({ passages, start: 'hub' });
  assert.ok(without.findings.some((f) => f.kind === 'dead-end' && f.passage === 'hub'));
  assert.ok(without.findings.some((f) => f.kind === 'unreachable-ending'));
});

test('engine fit: sugarcube for text loops, blockers for physics', () => {
  const textNeeds = { branching_text: [], inventory: [], hub_map: [], web: [] };
  const r = fitReport(textNeeds);
  assert.equal(r.recommended, 'sugarcube');
  const action = fitReport({ branching_text: [], physics: [], realtime_action: [] });
  assert.equal(action.recommended, null);
  assert.ok(action.alternatives.includes('godot'));
  assert.deepEqual(action.rows.find((x) => x.id === 'sugarcube').blockers, ['physics']);
});

test('engine adapters: only buildable engines resolve', () => {
  assert.equal(engineFor({ engine: { name: 'sugarcube' } }).id, 'sugarcube');
  assert.throws(() => engineFor({}), /No engine chosen yet/);
  assert.throws(() => engineFor({ engine: { name: 'renpy' } }), /planned in Twine Forge - no build adapter/);
  assert.throws(() => engineFor({ engine: { name: 'zork' } }), /Unknown engine/);
  const cat = loadEngineCatalog();
  for (const [id, e] of Object.entries(cat.engines)) {
    for (const f of Object.keys(e.fit)) assert.ok(cat.features[f], `${id}: unknown feature ${f}`);
    for (const f of Object.keys(cat.features)) assert.ok(e.fit[f], `${id}: no fit for ${f}`);
  }
});

test('updateYamlBlock edits one block and leaves the rest byte-for-byte', needsYaml, async () => {
  const { updateYamlBlock } = await import('../tools/lib/yaml.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-yaml-'));
  const f = path.join(dir, 'forge.yaml');
  const before = 'title: "T"   # keep me\nstyle_profile: null\nart:                  # a comment\n  style: null          # aligned\ngates:\n  qa: true    # spaced\n';
  fs.writeFileSync(f, before);
  updateYamlBlock(f, process.env.FORGE_TEST_PROJECT, 'style_profile', (doc) => doc.setIn(['style_profile', 'ui'], 'cozy'));
  updateYamlBlock(f, process.env.FORGE_TEST_PROJECT, 'engine', (doc) => doc.setIn(['engine', 'name'], 'sugarcube'));
  const after = fs.readFileSync(f, 'utf8');
  assert.ok(after.startsWith('title: "T"   # keep me\nstyle_profile:\n  ui: cozy\nart:                  # a comment\n  style: null          # aligned\ngates:\n  qa: true    # spaced\n'), after);
  assert.match(after, /\nengine:\n {2}name: sugarcube\n$/);
});

test('style profiles: list built-ins, apply parts, save to the library', needsYaml, async () => {
  const { listStyles, applyStyle, saveStyle } = await import('../tools/lib/styles.mjs');
  const yamlRoot = process.env.FORGE_TEST_PROJECT;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-home-'));
  process.env.FORGE_HOME = home;
  const names = listStyles(yamlRoot).map((s) => s.name);
  assert.ok(names.includes('storm-gothic') && names.includes('cozy-storybook'));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-style-'));
  fs.writeFileSync(path.join(root, 'forge.yaml'), 'title: "Isle"\nstyle_profile: null\nart:\n  style: null\n  checkpoint: mine.safetensors\n');
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  // Borrow the yaml package from the test project.
  fs.symlinkSync(path.join(yamlRoot, 'node_modules'), path.join(root, 'node_modules'), 'junction');
  const r1 = applyStyle(root, 'storm-gothic', { parts: ['prose', 'art'] });
  assert.deepEqual(r1.applied, ['prose', 'art']);
  const r2 = applyStyle(root, 'cozy-storybook', { parts: ['ui'] });
  assert.deepEqual(r2.files, ['src/custom/style.css']);
  const cfg = fs.readFileSync(path.join(root, 'forge.yaml'), 'utf8');
  assert.match(cfg, /style_profile:\n {2}prose: storm-gothic\n {2}art: storm-gothic\n {2}ui: cozy-storybook/);
  assert.match(cfg, /checkpoint: mine\.safetensors/, 'a profile without a checkpoint keeps the project one');
  assert.match(cfg, /style: painterly dark coastal gothic/);
  assert.match(fs.readFileSync(path.join(root, 'design/style/prose.md'), 'utf8'), /^<!-- Style profile 'storm-gothic'/);

  const s = saveStyle(root, 'isle-house', { description: 'test' });
  assert.deepEqual(s.saved.sort(), ['art', 'prose', 'ui']);
  assert.deepEqual(s.missing, ['audio']);
  assert.ok(!fs.readFileSync(path.join(home, 'styles', 'isle-house', 'ui.css'), 'utf8').startsWith('/* Style profile'), 'provenance line is not saved');
  assert.throws(() => saveStyle(root, 'isle-house'), /already exists/);
  assert.equal(listStyles(yamlRoot).find((x) => x.name === 'isle-house').builtin, false);
  delete process.env.FORGE_HOME;
});
