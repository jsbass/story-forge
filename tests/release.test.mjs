import test from 'node:test';
import assert from 'node:assert/strict';
import { createZip, listZip, readZipEntry, crc32 } from '../tools/lib/zip.mjs';
import { fitSize, optimizeSettings } from '../tools/release/optimize.mjs';
import { itchChecks, checkReferences, ITCH_LIMITS, electronMain, slugify, distributionSettings } from '../tools/release/package.mjs';
import { percentile, checkBudgets, performanceSettings } from '../tools/qa/perf.mjs';
import { toTwee } from '../tools/script/compiler.mjs';
import { parseTwee } from '../tools/build/twee.mjs';
import { forgeDataJs } from '../tools/build/builder.mjs';
import { STAGES } from '../tools/lib/state.mjs';

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('zip round-trips stored and deflated entries with UTF-8 names', () => {
  const html = Buffer.from('<html>' + 'hello world '.repeat(200) + '</html>');
  const img = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const zip = createZip([{ name: 'index.html', data: html }, { name: 'media/bg/café.webp', data: img }]);
  const entries = listZip(zip);
  assert.deepEqual(entries.map((e) => e.name), ['index.html', 'media/bg/café.webp']);
  assert.equal(entries[0].method, 8, 'text is deflated');
  assert.ok(entries[0].csize < html.length);
  assert.equal(entries[1].method, 0, 'media is stored');
  assert.deepEqual(readZipEntry(zip, entries[0]), html);
  assert.deepEqual(readZipEntry(zip, entries[1]), img);
  assert.equal(entries[0].crc, crc32(html));
});

test('fitSize caps the longest side without upscaling', () => {
  assert.deepEqual(fitSize(832, 1216, 768), { width: 525, height: 768 });
  assert.deepEqual(fitSize(1344, 768, 1920), { width: 1344, height: 768 });
  assert.deepEqual(fitSize(100, 50, null), { width: 100, height: 50 });
});

test('settings merge project overrides over defaults', () => {
  const o = optimizeSettings({ optimize: { images: { quality: 70, max: { bg: 1280 } } } });
  assert.equal(o.images.quality, 70);
  assert.equal(o.images.max.bg, 1280);
  assert.equal(o.images.max.portrait, 768, 'untouched defaults survive');
  const p = performanceSettings({ performance: { budgets: { save_kb: 50 } } });
  assert.equal(p.budgets.save_kb, 50);
  assert.equal(p.budgets.first_passage_ms, 2000);
  assert.deepEqual(distributionSettings({}).desktop.platforms, ['win32']);
});

test('itch checks: index.html at root and the documented limits', () => {
  const ok = itchChecks([{ name: 'index.html', bytes: 10 }, { name: 'media/bg/a.webp', bytes: 10 }]);
  assert.deepEqual(ok.problems, []);
  const files = Array.from({ length: ITCH_LIMITS.files + 1 }, (_, i) => ({ name: `f${i}.txt`, bytes: 1 }));
  files.push({ name: 'big.webm', bytes: ITCH_LIMITS.file_bytes + 1 }, { name: 'x'.repeat(241), bytes: 1 });
  const bad = itchChecks(files).problems.join('\n');
  assert.match(bad, /index\.html must be in the ZIP root/);
  assert.match(bad, /1002 files|1003 files/);
  assert.match(bad, /big\.webm/);
  assert.match(bad, /longer than 240/);
});

test('reference check catches missing, absolute and wrong-case URLs', () => {
  const files = [{ name: 'index.html' }, { name: 'media/bg/Door.webp' }, { name: 'media/portrait/a.webp' }];
  const problems = checkReferences(files, { assets: { 'bg:door': 'media/bg/door.webp', 'portrait:a': 'media/portrait/a.webp', 'bg:x': '/media/x.webp' }, assetsSmall: { 'bg:y': 'media/bg/y.webp' } });
  assert.equal(problems.length, 3);
  assert.match(problems.join('\n'), /case differs/);
  assert.match(problems.join('\n'), /not a relative path/);
  assert.match(problems.join('\n'), /y\.webp: file missing/);
});

test('percentile and budget checks', () => {
  assert.equal(percentile([10, 20, 30, 40, 100], 95), 100);
  assert.equal(percentile([10, 20, 30, 40, 100], 50), 30);
  assert.equal(percentile([], 50), null);
  const s = performanceSettings({});
  const results = [
    { profile: 'desktop', first_passage_ms: 200, transition_p95_ms: 20, save_bytes: 3000, heap_growth_mb: 30, transitions: 500, errors: [], stuck: 0 },
    { profile: 'mobile', first_passage_ms: 2500, transition_p95_ms: 90, save_bytes: 200 * 1024, heap_growth_mb: 1, transitions: 40, errors: ['boom'], stuck: 2 },
  ];
  const f = checkBudgets('optimized', results, { index: 'index.html', html_bytes: 100, total_bytes: 1000 }, s);
  const kinds = f.map((x) => x.kind).sort();
  assert.deepEqual(kinds, ['js-error', 'load-time', 'memory', 'save-size', 'stuck']);
  assert.equal(f.find((x) => x.kind === 'stuck').severity, 'S3');
});

test('toTwee escapes names and :: lines so parseTwee round-trips', () => {
  const passages = [
    { name: 'odd [name] {x}', tags: ['a'], text: 'line\n:: not a header' },
    { name: 'code.js', tags: ['script'], text: 'var a = 1;\n::b' },
  ];
  const back = parseTwee(toTwee(passages));
  assert.deepEqual(back.map((p) => p.name), ['odd [name] {x}', 'code.js']);
  assert.equal(back[0].text, 'line\n:: not a header');
  assert.deepEqual(back[0].tags, ['a']);
  assert.equal(back[1].text, 'var a = 1;\n::b');
});

test('forge-data passage carries optimized asset maps and the build mode', () => {
  const js = forgeDataJs({ characters: {}, modules: {}, invariants: [], endings: [], assets: { 'bg:a': 'media/bg/a.webp' }, assetsSmall: { 'bg:a': 'media/bg/a.small.webp' }, posters: {}, mediaByPassage: { p1: ['bg:a'] }, build: { id: 'b1' } }, 'release');
  assert.match(js, /setup\.forge\.assetsSmall = \{\n  "bg:a": "media\/bg\/a\.small\.webp"/);
  assert.match(js, /setup\.forge\.mediaByPassage = \{"p1":\["bg:a"\]\}/);
  assert.match(js, /setup\.forge\.build = \{"id":"b1","mode":"release"\}/);
});

test('pipeline has optimize before qa and release last', () => {
  const ids = STAGES.map((s) => s.id);
  assert.ok(ids.indexOf('build') < ids.indexOf('optimize') && ids.indexOf('optimize') < ids.indexOf('qa'));
  assert.equal(ids[ids.length - 1], 'release');
});

test('electron wrapper is sandboxed and keeps navigation local', () => {
  const js = electronMain({ productName: 'The "Keeper"', width: 1280, height: 800 });
  assert.match(js, /contextIsolation: true, nodeIntegration: false, sandbox: true/);
  assert.match(js, /app\.setName\("The \\"Keeper\\""\)/);
  assert.match(js, /will-navigate/);
  assert.equal(slugify('The Lantern Keeper!'), 'the-lantern-keeper');
});
