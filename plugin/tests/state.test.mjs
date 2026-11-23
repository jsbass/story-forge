import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scaffoldProject, initialCommit } from '../tools/lib/init.mjs';
import { loadPipeline, savePipeline, transition, computeStatus, nextStage } from '../tools/lib/state.mjs';
import { loadDeps, saveDeps, recordDeps, impactOf, staleArtifacts } from '../tools/lib/deps.mjs';
import { addFeedback, listFeedback, resolveFeedback, suggestRoute } from '../tools/lib/feedback.mjs';
import { commitAll, tag, restorePaths, git } from '../tools/lib/git.mjs';

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-test-'));
  const root = scaffoldProject(path.join(dir, 'game'), { title: 'Test Game' });
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Forge Test']);
  initialCommit(root);
  return root;
}
const write = (root, f, t) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); };

test('scaffold creates the expected layout', () => {
  const root = tmpProject();
  for (const f of ['forge.yaml', 'state/pipeline.json', 'state/deps.json', 'state/feedback/index.json', '.forge/forge.mjs', '.claude/launch.json', 'script/.gitkeep']) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
  assert.match(fs.readFileSync(path.join(root, 'forge.yaml'), 'utf8'), /ifid: [0-9A-F-]{36}/);
});

test('gates enforce order, approvals version and detect staleness', () => {
  const root = tmpProject();
  const p = loadPipeline(root);
  assert.throws(() => transition(root, p, 'bible', 'start'), /waiting on approval of interview/);
  transition(root, p, 'interview', 'start');
  assert.throws(() => transition(root, p, 'interview', 'submit'), /missing artifacts/);
  write(root, 'design/interview.md', '# Interview\n');
  transition(root, p, 'interview', 'submit');
  transition(root, p, 'interview', 'approve');
  assert.equal(p.stages.interview.version, 1);

  write(root, 'design/story-bible.md', 'bible');
  write(root, 'design/branch-map.yaml', 'start: s1');
  transition(root, p, 'bible', 'start');
  transition(root, p, 'bible', 'submit');
  transition(root, p, 'bible', 'approve');
  savePipeline(root, p);

  let rows = computeStatus(root, p);
  assert.equal(nextStage(rows).id, 'characters');

  // Editing the approved interview marks it modified and bible stale.
  write(root, 'design/interview.md', '# Interview v2\n');
  rows = computeStatus(root, p);
  assert.ok(rows[0].modified.changed.includes('design/interview.md'));
  assert.ok(rows[1].stale);
  assert.equal(nextStage(rows).id, 'interview');

  // Re-approving interview bumps its version; bible stays stale until re-approved.
  transition(root, p, 'interview', 'approve');
  rows = computeStatus(root, p);
  assert.equal(rows[0].modified, null);
  assert.ok(rows[1].stale && /interview re-approved/.test(rows[1].staleReasons[0]));
  transition(root, p, 'bible', 'approve');
  assert.equal(computeStatus(root, p)[1].stale, false);
});

test('deps: impact analysis is transitive and flags stale artifacts', () => {
  const root = tmpProject();
  write(root, 'characters/mara.yaml', 'id: mara');
  write(root, 'script/s1.script.md', '# SCENE s1');
  write(root, 'src/story/s1.twee', ':: s1');
  const d = loadDeps(root);
  recordDeps(root, d, 'script/s1.script.md', ['characters/mara.yaml']);
  recordDeps(root, d, 'src/story/s1.twee', ['script/s1.script.md']);
  saveDeps(root, d);
  assert.deepEqual(staleArtifacts(root, d), []);
  write(root, 'characters/mara.yaml', 'id: mara\nage: 35');
  const imp = impactOf(root, d, ['characters/']);
  assert.deepEqual(imp.map((i) => [i.artifact, i.depth, i.stale]), [['script/s1.script.md', 1, true], ['src/story/s1.twee', 2, false]]);
});

test('feedback: add, route, list, resolve', () => {
  const root = tmpProject();
  assert.equal(suggestRoute(['characters/mara.yaml']), 'character-designer');
  assert.equal(suggestRoute(['design/loops/stats.md']), 'loop-designer');
  const fb = addFeedback(root, { text: 'Mara sounds too cheerful in scene 3', targets: ['script/s3.script.md'] });
  assert.equal(fb.id, 'FB-0001');
  assert.equal(fb.route, 'dialog-writer');
  assert.equal(listFeedback(root, { open: true }).length, 1);
  resolveFeedback(root, 'FB-0001', { note: 'Rewrote lines', commit: 'abc123' });
  assert.equal(listFeedback(root, { open: true }).length, 0);
  assert.match(fs.readFileSync(path.join(root, 'state/feedback/FB-0001.md'), 'utf8'), /status: resolved[\s\S]*Rewrote lines \(commit abc123\)/);
});

test('git: approval tags allow restoring a stage', () => {
  const root = tmpProject();
  write(root, 'script/a.script.md', 'v1');
  commitAll(root, 'v1');
  tag(root, 'stage/script/v1');
  write(root, 'script/a.script.md', 'v2');
  write(root, 'script/b.script.md', 'new');
  commitAll(root, 'v2');
  restorePaths(root, 'stage/script/v1', ['script']);
  assert.equal(fs.readFileSync(path.join(root, 'script/a.script.md'), 'utf8'), 'v1');
  assert.equal(fs.existsSync(path.join(root, 'script/b.script.md')), false);
});
