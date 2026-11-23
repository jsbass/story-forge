// Twee passages + story format -> playable Twine 2 HTML (what Tweego does).
import vm from 'node:vm';
import { escapeHtml } from '../lib/util.mjs';

export const SPECIAL = new Set(['StoryTitle', 'StoryData']);

/** Evaluate a Twine 2 story format's format.js and return its descriptor. */
export function loadStoryFormat(formatJsText) {
  let captured = null;
  const sandbox = { window: { storyFormat: (o) => { captured = o; } } };
  sandbox.storyFormat = sandbox.window.storyFormat;
  vm.runInNewContext(formatJsText, sandbox, { timeout: 5000 });
  if (!captured || typeof captured.source !== 'string') throw new Error('format.js did not call window.storyFormat({ source: ... })');
  return captured;
}

/**
 * @param {object} o
 * @param {{name,tags,text,meta?}[]} o.passages  all passages (script/stylesheet passages included)
 * @param {{name,version,source}} o.format
 * @param {string} o.title
 * @param {string} o.ifid
 * @param {string} o.start   start passage name
 */
export function compileHtml({ passages, format, title, ifid, start }) {
  const scripts = passages.filter((p) => p.tags.includes('script')).map((p) => `/* ${p.name} */\n${p.text}`);
  const styles = passages.filter((p) => p.tags.includes('stylesheet')).map((p) => `/* ${p.name} */\n${p.text}`);
  const story = passages.filter((p) => !SPECIAL.has(p.name) && !p.tags.includes('script') && !p.tags.includes('stylesheet'));

  let startPid = null;
  const items = story.map((p, i) => {
    const pid = i + 1;
    if (p.name === start) startPid = pid;
    const pos = p.meta?.position || `${(i % 10) * 125 + 25},${Math.floor(i / 10) * 125 + 25}`;
    const size = p.meta?.size || '100,100';
    return `<tw-passagedata pid="${pid}" name="${escapeHtml(p.name)}" tags="${escapeHtml(p.tags.join(' '))}" position="${pos}" size="${size}">${escapeHtml(p.text)}</tw-passagedata>`;
  });
  if (!startPid) throw new Error(`Start passage '${start}' not found`);

  const raw = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1');
  const data =
    `<tw-storydata name="${escapeHtml(title)}" startnode="${startPid}" creator="Story Forge" creator-version="0.1.0" ` +
    `format="${escapeHtml(format.name)}" format-version="${escapeHtml(format.version)}" ifid="${escapeHtml(ifid)}" options="" tags="" zoom="1" hidden>` +
    `<style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css">${raw(styles.join('\n\n'))}</style>` +
    `<script role="script" id="twine-user-script" type="text/twine-javascript">${raw(scripts.join('\n\n'))}</script>` +
    items.join('') +
    `</tw-storydata>`;

  return format.source
    .replaceAll('{{STORY_NAME}}', () => escapeHtml(title))
    .replaceAll('{{STORY_DATA}}', () => data);
}
