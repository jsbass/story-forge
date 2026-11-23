import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStoryFormat, compileHtml } from '../tools/build/html.mjs';
import { parseHeader } from '../tools/build/twee.mjs';

// Real SugarCube uses {{STORY_NAME}} twice (title + meta), so the fake does too.
const FAKE_FORMAT = `window.storyFormat({"name":"SugarCube","version":"2.37.3","source":"<html><title>{{STORY_NAME}}</title><meta name=\\"x\\" content=\\"{{STORY_NAME}}\\"><body>{{STORY_DATA}}</body></html>"});`;

test('loads a story format descriptor', () => {
  const f = loadStoryFormat(FAKE_FORMAT);
  assert.equal(f.name, 'SugarCube');
  assert.equal(f.version, '2.37.3');
});

test('compiles passages into tw-storydata', () => {
  const format = loadStoryFormat(FAKE_FORMAT);
  const html = compileHtml({
    format,
    title: 'Test & Story',
    ifid: 'ABC',
    start: 'Start',
    passages: [
      { name: 'StoryTitle', tags: [], text: 'x' },
      { name: 'core.js', tags: ['script'], text: 'var a = "</script>";' },
      { name: 'style.css', tags: ['stylesheet'], text: 'body{color:red}' },
      { name: 'Start', tags: ['nobr'], text: '<<link "Go $" "Next">><</link>>' },
      { name: 'Next', tags: [], text: 'Done' },
    ],
  });
  assert.match(html, /<title>Test &amp; Story<\/title>/);
  assert.doesNotMatch(html, /\{\{STORY_NAME\}\}/);
  assert.match(html, /startnode="1"/);
  assert.match(html, /<tw-passagedata pid="1" name="Start" tags="nobr"/);
  assert.match(html, /&lt;&lt;link &quot;Go \$&quot;/);
  assert.match(html, /var a = "<\\\/script>";/);
  assert.match(html, /body\{color:red\}/);
  assert.doesNotMatch(html, /name="StoryTitle"/);
});

test('throws when the start passage is missing', () => {
  const format = loadStoryFormat(FAKE_FORMAT);
  assert.throws(() => compileHtml({ format, title: 't', ifid: 'i', start: 'Nope', passages: [{ name: 'A', tags: [], text: '' }] }), /Start passage/);
});

test('parses twee headers with tags and metadata', () => {
  assert.deepEqual(parseHeader(' scene_01 [nobr scene] {"position":"10,20"}'), { name: 'scene_01', tags: ['nobr', 'scene'], meta: { position: '10,20' } });
  assert.deepEqual(parseHeader('Plain name'), { name: 'Plain name', tags: [], meta: null });
});
