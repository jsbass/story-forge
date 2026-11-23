// Shared filesystem / text helpers. No third-party dependencies.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Read a text file, strip BOM, normalise line endings to \n. */
export function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

export function readTextIfExists(file) {
  return fs.existsSync(file) ? readText(file) : null;
}

export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

export function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(readText(file));
}

export function writeJson(file, data) {
  writeText(file, JSON.stringify(data, null, 2) + '\n');
}

/** Content hash of a file (line endings normalised so Windows/Unix agree). */
export function hashFile(file) {
  if (!fs.existsSync(file)) return null;
  const st = fs.statSync(file);
  if (st.isDirectory()) return hashDir(file);
  const buf = fs.readFileSync(file);
  const text = buf.toString('utf8');
  const data = text.includes('�') ? buf : text.replace(/\r\n?/g, '\n');
  return crypto.createHash('sha1').update(data).digest('hex').slice(0, 12);
}

/** Hash of every file under a directory (relative path + content hash). */
export function hashDir(dir) {
  const h = crypto.createHash('sha1');
  for (const f of listFiles(dir)) h.update(toPosix(path.relative(dir, f)) + ':' + hashFile(f) + '\n');
  return h.digest('hex').slice(0, 12);
}

/** Recursively list files under dir (sorted, posix-stable order). */
export function listFiles(dir, filter = () => true) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (filter(p)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

export function rel(root, file) {
  return toPosix(path.relative(root, file));
}

export function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

export function timestampId(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Split on a separator, ignoring separators inside single/double quotes. */
export function splitTopLevel(s, sep) {
  const parts = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === '\\' && i + 1 < s.length) { cur += s[++i]; continue; }
      if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      q = c; cur += c;
    } else if (c === sep) {
      parts.push(cur); cur = '';
    } else cur += c;
  }
  parts.push(cur);
  return parts;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
