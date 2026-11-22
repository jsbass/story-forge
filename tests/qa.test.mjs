import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStatic, extractRefs, extractVars, shortestPath } from '../tools/qa/static.mjs';
import { knowledgeRisks } from '../tools/qa/lines.mjs';
import { compileScript } from '../tools/script/compiler.mjs';

const P = (name, text, tags = []) => ({ name, tags, text });

test('extracts links from macros and wiki links', () => {
  const refs = extractRefs('<<link "Go" "a">><</link>> [[b]] [[Text|c]] [[T->d]] [[e<-T]] [[f][$x to 1]] <<goto "g">> <<include "h">>');
  assert.deepEqual(refs.map((r) => `${r.kind}:${r.to}`).sort(), ['goto:g', 'include:h', 'link:a', 'link:b', 'link:c', 'link:d', 'link:e', 'link:f'].sort());
});

test('extracts assigned vs read variables', () => {
  const v = extractVars('<<set $a to 1>><<set $b += $c>><<if $d is 2>>$e<</if>>');
  assert.deepEqual([...v.assigned].sort(), ['a', 'b']);
  assert.ok(v.read.has('c') && v.read.has('d') && v.read.has('e') && v.read.has('b'));
  assert.ok(!v.read.has('a'));
});

test('finds broken links, dead ends, unreachable passages, undefined and unused vars', () => {
  const passages = [
    P('StoryInit', '<<set $trust to 0>><<set $unused to 1>>'),
    P('start', '<<if $trust > 1>><<link "A" "a">><</link>><</if>><<link "B" "b">><</link>><<link "X" "nowhere">><</link>>', ['scene']),
    P('a', '<<forge_ending "good" "Good">>', ['ending']),
    P('b', 'Nothing here. $mystery', ['scene']),
    P('orphan', '<<link "A" "a">><</link>>'),
    P('lost_end', '<<forge_ending "lost" "Lost">>', ['ending']),
    P('w', '<<widget "x">><</widget>>', ['widget']),
  ];
  const r = analyzeStatic({ passages, start: 'start', expectedEndings: [{ id: 'good' }, { id: 'secret' }], expectedScenes: ['start', 'b', 'c'] });
  const kinds = r.findings.map((f) => `${f.severity}:${f.kind}:${f.passage}`);
  assert.ok(kinds.includes('S2:broken-link:start'));
  assert.ok(kinds.includes('S2:dead-end:b'));
  assert.ok(kinds.includes('S3:unreachable:orphan'));
  assert.ok(kinds.includes('S2:unreachable-ending:lost_end'));
  assert.ok(kinds.includes('S2:undefined-variable:b'));
  assert.ok(kinds.includes('S4:unused-variable:null'));
  assert.ok(kinds.includes('S2:missing-ending:null'));
  assert.ok(kinds.includes('S2:missing-scene:c'));
  assert.ok(!kinds.some((k) => k.includes(':w')), 'widgets are not story passages');
  assert.deepEqual(r.graph.endings.sort(), ['a', 'lost_end']);
});

test('knowledge risks: lines reachable before the learning scene', () => {
  const src = `# SCENE s1
* [Left] -> s2
* [Right] -> learn
# SCENE learn
MARA: The captain is alive!
-> s2
# SCENE s2
MARA: We need to find the captain.
END fin
`;
  const r = compileScript(src, 'x.script.md');
  const passages = r.passages;
  const st = analyzeStatic({ passages, start: 's1' });
  assert.deepEqual(shortestPath(st.graph, 's1', 'fin'), null);
  const risks = knowledgeRisks({ lines: r.refs.lines }, st.graph, [{ id: 'mara', knowledge: [{ fact: 'Captain is alive', learned_at: 'learn' }] }]);
  assert.equal(risks.length, 1);
  assert.deepEqual(risks[0].linesAtRisk.map((l) => l.passage), ['s2']);
  assert.deepEqual(risks[0].linesAtRisk[0].route, ['s1', 's2']);
});
