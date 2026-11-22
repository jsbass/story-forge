import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScript } from '../tools/script/parser.mjs';
import { compileScript, validateScripts, toTwee } from '../tools/script/compiler.mjs';
import { parseTwee } from '../tools/build/twee.mjs';

const SAMPLE = `// sample
# SCENE scene_07 — The Flooded Hold [chapter2]
@bg hold_flooded   @music tension_low
@portrait mara worried

The hold is half under water.
Rope creaks somewhere above.

MARA: Right then. Water's at the second rung.
MARA (quiet): You didn't see the Captain's log. Did you?
> set $visited_hold = true

?? if $mara_aff >= 5
MARA: I trust you. Mostly.
?? else
MARA: Don't make me regret this.
?? end

* [Tell her the truth] -> scene_08 {set $mara_aff += 2}
* [Lie] -> .lie {set $lied = true}
* [Use the rope] -> .rope {requires $has_rope; else disabled; do <<stat "mara_aff" 1>>}

## lie — A Lie
MARA: Hm.
-> scene_08

## rope
END drowned "Lost to the Deep"

# SCENE scene_08 — Deck
OLD SAILOR: Ahoy.
END escaped — Free at Last
`;

test('parses scenes, nodes, and item types', () => {
  const ast = parseScript(SAMPLE, 'a.script.md');
  assert.deepEqual(ast.errors, []);
  assert.deepEqual(ast.passages.map((p) => p.name), ['scene_07', 'scene_07.lie', 'scene_07.rope', 'scene_08']);
  const s7 = ast.passages[0];
  assert.equal(s7.title, 'The Flooded Hold');
  assert.deepEqual(s7.tags, ['chapter2']);
  const types = s7.body.map((b) => b.type);
  assert.deepEqual(types.slice(0, 4), ['media', 'media', 'media', 'text']);
  assert.equal(s7.body[3].text, 'The hold is half under water. Rope creaks somewhere above.');
  const say = s7.body.find((b) => b.type === 'say' && b.paren);
  assert.equal(say.speaker, 'MARA');
  assert.equal(say.paren, 'quiet');
  const rope = s7.body.find((b) => b.type === 'choice' && b.label === 'Use the rope');
  assert.equal(rope.requires, '$has_rope');
  assert.equal(rope.otherwise, 'disabled');
  assert.deepEqual(rope.do, ['<<stat "mara_aff" 1>>']);
  assert.deepEqual(ast.passages[2].ending, { id: 'drowned', title: 'Lost to the Deep' });
  assert.deepEqual(ast.passages[3].ending, { id: 'escaped', title: 'Free at Last' });
});

test('compiles to SugarCube twee with resolved targets and refs', () => {
  const r = compileScript(SAMPLE, 'a.script.md');
  assert.deepEqual(r.errors, []);
  const s7 = r.passages[0];
  assert.ok(s7.tags.includes('nobr') && s7.tags.includes('scene') && s7.tags.includes('chapter2'));
  assert.match(s7.text, /<<forge_scene "scene_07" "The Flooded Hold">>/);
  assert.match(s7.text, /<<forge_media "bg" "hold_flooded">>/);
  assert.match(s7.text, /<<forge_media "portrait" "mara" "worried">>/);
  assert.match(s7.text, /<<forge_say "mara" "quiet">>You didn't see/);
  assert.match(s7.text, /<<link "Lie" "scene_07.lie">><<set \$lied = true>><<\/link>>/);
  assert.match(s7.text, /<<if \$has_rope>>.*<<else>><div class="forge-choice forge-choice-disabled">/);
  assert.match(s7.text, /<<if \$mara_aff >= 5>>\n<<forge_say "mara">>I trust you/);
  assert.equal((s7.text.match(/class="forge-choices"/g) || []).length, 1, 'consecutive choices grouped');
  assert.ok(r.passages[2].tags.includes('ending'));
  assert.deepEqual(r.refs.speakers.sort(), ['mara', 'old_sailor']);
  assert.equal(r.refs.links.length, 4);
  assert.deepEqual(r.refs.endings.map((e) => e.id), ['drowned', 'escaped']);
  assert.equal(r.refs.media.length, 3);
});

test('round-trips through twee serialisation', () => {
  const r = compileScript(SAMPLE, 'a.script.md');
  const back = parseTwee(toTwee(r.passages));
  assert.deepEqual(back.map((p) => p.name), r.passages.map((p) => p.name));
  assert.deepEqual(back[0].tags, r.passages[0].tags);
  assert.equal(back[0].text, r.passages[0].text);
});

test('reports syntax errors with line numbers', () => {
  const bad = `MARA: too early
# SCENE s1
* Missing brackets -> s2
?? if $x
> notanassignment
* [Ok] -> s2 {bogus thing}
@unknown foo
`;
  const ast = parseScript(bad, 'bad.script.md');
  const msgs = ast.errors.map((e) => `${e.line}:${e.message}`);
  assert.ok(msgs.some((m) => m.startsWith('1:Content before')));
  assert.ok(msgs.some((m) => m.startsWith('3:Malformed choice')));
  assert.ok(msgs.some((m) => m.startsWith('5:Not an assignment')));
  assert.ok(msgs.some((m) => m.startsWith('6:Unknown choice modifier')));
  assert.ok(msgs.some((m) => m.startsWith('7:Unknown directive')));
  assert.ok(msgs.some((m) => m.startsWith('4:') && /never closed/.test(m)));
});

test('cross-file validation catches unknown targets and speakers', () => {
  const a = compileScript(`# SCENE a\nBOB: hi\n* [Go] -> b\n* [Nope] -> missing\n`, 'a.script.md');
  const b = compileScript(`# SCENE b\nEND fin\n`, 'b.script.md');
  const errs = validateScripts([a, b], { characters: ['alice'] });
  assert.ok(errs.some((e) => /unknown passage 'missing'/.test(e.message)));
  assert.ok(errs.some((e) => /Unknown speaker 'bob'/.test(e.message)));
  assert.equal(errs.length, 2);
});
