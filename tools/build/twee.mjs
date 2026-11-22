// Minimal Twee 3 reader (enough for Forge's own output and hand-written src/custom/*.twee).

const unescapeName = (s) => s.replace(/\\(.)/g, '$1');

/** Parse a passage header line (without the leading '::'). */
export function parseHeader(h) {
  let rest = h.trim();
  let meta = null;
  let tags = [];
  // Trailing {json} metadata
  if (rest.endsWith('}')) {
    const start = findUnescaped(rest, '{');
    if (start > 0) {
      try {
        meta = JSON.parse(rest.slice(start));
        rest = rest.slice(0, start).trim();
      } catch { /* not metadata */ }
    }
  }
  // Trailing [tags]
  if (rest.endsWith(']')) {
    const start = findUnescaped(rest, '[');
    if (start > 0) {
      tags = rest.slice(start + 1, -1).split(/\s+/).filter(Boolean);
      rest = rest.slice(0, start).trim();
    }
  }
  return { name: unescapeName(rest), tags, meta };
}

function findUnescaped(s, ch) {
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === ch && s[i - 1] !== '\\') return i;
  }
  return -1;
}

/** Parse Twee 3 text into [{name, tags, meta, text, line}]. */
export function parseTwee(text, file = 'story.twee') {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const passages = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('::')) {
      if (cur) passages.push(finish(cur));
      cur = { ...parseHeader(l.slice(2)), body: [], line: i + 1, file };
    } else if (cur) {
      cur.body.push(l.startsWith('\\::') ? l.slice(1) : l);
    }
  }
  if (cur) passages.push(finish(cur));
  return passages;
}

/** Wrap raw code (JS/CSS) as a Twee passage, escaping lines that start with '::'. */
export function wrapCode(name, tags, code) {
  return `:: ${name} [${tags.join(' ')}]\n${code.replace(/\r\n?/g, '\n').replace(/^::/gm, '\\::').replace(/\s+$/, '')}\n`;
}

function finish(p) {
  const text = p.body.join('\n').replace(/\s+$/, '');
  const { body, ...rest } = p;
  return { ...rest, text };
}
