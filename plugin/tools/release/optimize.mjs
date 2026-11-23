// Performance Optimizer: build/release -> build/optimized (the input for performance QA and packaging).
//  - Images (PNG from ComfyUI) -> WebP, capped to the size they are shown at, plus a small variant for phones.
//    Encoding uses the project's Playwright Chromium, so no extra tools are needed.
//  - Video: a WebP poster frame so something shows while the clip loads.
//  - Audio: already Opus from ComfyUI; re-encoded to the target bitrate only when ffmpeg is available.
// Encoded files are cached by content hash in build/.optimize-cache/.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readJson, writeJson, writeText, rmrf } from '../lib/util.mjs';
import { loadProject } from '../lib/project.mjs';
import { renderBuild } from '../build/builder.mjs';

export const DEFAULT_OPTIMIZE = {
  images: {
    format: 'webp',
    quality: 82,
    max: { bg: 1920, portrait: 768, ui: 1024 }, // longest side, px
    small: { bg: 960, portrait: 640 }, // variant used on screens up to 1024 CSS px (or Save-Data)
  },
  video_posters: true,
  audio_bitrate: { music: '96k', ambience: '64k', sfx: '64k', voice: '48k' },
  ffmpeg: null, // path to ffmpeg; otherwise looked up on PATH. Without it audio is copied as-is.
};

const IMAGE_KINDS = new Set(['bg', 'portrait', 'ui']);
const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
  return out;
};

export function optimizeSettings(config) {
  return merge(DEFAULT_OPTIMIZE, config.optimize || {});
}

export function findFfmpeg(settings) {
  const candidates = [settings.ffmpeg, process.env.FFMPEG, 'ffmpeg'].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ['-version'], { stdio: 'ignore' });
    if (r.status === 0) return c;
  }
  return null;
}

/** Fit (w, h) inside a longest-side cap without upscaling. */
export function fitSize(w, h, max) {
  if (!max || Math.max(w, h) <= max) return { width: w, height: h };
  const k = max / Math.max(w, h);
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

function requirePlaywright(root) {
  try {
    return createRequire(path.join(root, 'package.json'))('playwright');
  } catch {
    throw new Error("Playwright isn't installed for this project. Run: node .forge/forge.mjs setup");
  }
}

/** Image/video encoding in headless Chromium (canvas -> WebP). */
class Encoder {
  constructor(root) { this.root = root; }
  async page() {
    if (this._page) return this._page;
    const { chromium } = requirePlaywright(this.root);
    this.browser = await chromium.launch({ headless: true });
    this._page = await this.browser.newPage();
    await this._page.setContent('<!doctype html><title>encoder</title>');
    return this._page;
  }
  async close() { if (this.browser) await this.browser.close(); }

  /** @returns {{width, height, sizes: {name, width, height, data(base64)}[]}} */
  async image(file, targets, { mime = 'image/webp', quality = 0.82 } = {}) {
    const page = await this.page();
    return page.evaluate(async ({ b64, targets, mime, quality }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes]));
      const sizes = [];
      for (const t of targets) {
        const k = t.max && Math.max(bmp.width, bmp.height) > t.max ? t.max / Math.max(bmp.width, bmp.height) : 1;
        const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
        const c = new OffscreenCanvas(w, h);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmp, 0, 0, w, h);
        const blob = await c.convertToBlob({ type: mime, quality });
        if (blob.type !== mime) throw new Error(`This Chromium can't encode ${mime}`);
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        sizes.push({ name: t.name, width: w, height: h, data: btoa(s) });
      }
      return { width: bmp.width, height: bmp.height, sizes };
    }, { b64: fs.readFileSync(file).toString('base64'), targets, mime, quality });
  }

  /** First frame (at ~0.1 s) of a video as WebP. */
  async poster(file, { max = 960, quality = 0.8 } = {}) {
    const page = await this.page();
    return page.evaluate(async ({ b64, type, max, quality }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const v = document.createElement('video');
      v.muted = true;
      v.src = URL.createObjectURL(new Blob([bytes], { type }));
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('video decode failed')); });
      v.currentTime = Math.min(0.1, v.duration || 0);
      await new Promise((res) => { v.onseeked = res; setTimeout(res, 1500); });
      const k = Math.max(v.videoWidth, v.videoHeight) > max ? max / Math.max(v.videoWidth, v.videoHeight) : 1;
      const c = new OffscreenCanvas(Math.round(v.videoWidth * k), Math.round(v.videoHeight * k));
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/webp', quality })).arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return { width: c.width, height: c.height, data: btoa(s) };
    }, { b64: fs.readFileSync(file).toString('base64'), type: file.endsWith('.mp4') ? 'video/mp4' : 'video/webm', max, quality });
  }
}

const sha = (...parts) => crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 20);
const fileSha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/**
 * Optimize the last release build into build/optimized/.
 * @returns report (also written to release/optimize.json)
 */
export async function optimize(root, { log = console.log } = {}) {
  const project = loadProject(root);
  const settings = optimizeSettings(project.config);
  const buildDir = project.paths.build;
  const info = readJson(path.join(buildDir, 'build-info.json'));
  if (!info?.outputs?.release) throw new Error('No release build. Run: node .forge/forge.mjs build');
  const data = readJson(path.join(buildDir, 'forge-data.json'));
  if (!data) throw new Error('build/forge-data.json missing - rebuild with this version of Twine Forge (forge build)');

  const srcDir = path.join(buildDir, 'release');
  const outDir = path.join(buildDir, 'optimized');
  const cacheDir = path.join(buildDir, '.optimize-cache');
  rmrf(outDir);
  fs.mkdirSync(cacheDir, { recursive: true });

  const enc = new Encoder(root);
  const ffmpeg = findFfmpeg(settings);
  const items = [];
  const notes = [];
  const assets = {};
  const assetsSmall = {};
  const posters = {};
  const q = Math.round(settings.images.quality);

  const put = (relUrl, buf) => {
    const dest = path.join(outDir, relUrl);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    return buf.length;
  };
  const cached = async (key, ext, make) => {
    const f = path.join(cacheDir, `${key}${ext}`);
    if (fs.existsSync(f)) return fs.readFileSync(f);
    const buf = await make();
    fs.writeFileSync(f, buf);
    return buf;
  };

  try {
    for (const [k, url] of Object.entries(data.assets)) {
      const [kind, ...idParts] = k.split(':');
      const id = idParts.join(':');
      const src = path.join(srcDir, url);
      if (!fs.existsSync(src)) { notes.push(`${k}: ${url} missing from build/release (skipped)`); continue; }
      const before = fs.statSync(src).size;
      const h = fileSha(src);
      const base = `media/${kind}/${id}`;
      const item = { key: k, from: url, bytes_before: before };

      if (IMAGE_KINDS.has(kind)) {
        const targets = [{ name: 'full', max: settings.images.max?.[kind] || null }];
        if (settings.images.small?.[kind]) targets.push({ name: 'small', max: settings.images.small[kind] });
        const key = sha(h, JSON.stringify(targets), settings.images.format, q);
        const metaFile = path.join(cacheDir, `${key}.json`);
        let meta = readJson(metaFile);
        if (!meta || !meta.sizes.every((s) => fs.existsSync(path.join(cacheDir, `${key}.${s.name}.webp`)))) {
          const r = await enc.image(src, targets, { mime: `image/${settings.images.format}`, quality: q / 100 });
          for (const s of r.sizes) fs.writeFileSync(path.join(cacheDir, `${key}.${s.name}.webp`), Buffer.from(s.data, 'base64'));
          meta = { width: r.width, height: r.height, sizes: r.sizes.map(({ name, width, height }) => ({ name, width, height })) };
          writeJson(metaFile, meta);
        }
        const full = fs.readFileSync(path.join(cacheDir, `${key}.full.webp`));
        // Keep the original if WebP somehow came out bigger (rare: tiny flat images).
        if (full.length < before) {
          assets[k] = `${base}.webp`;
          item.to = assets[k];
          item.bytes_after = put(assets[k], full);
          item.size = `${meta.width}x${meta.height} -> ${meta.sizes[0].width}x${meta.sizes[0].height}`;
        } else {
          assets[k] = url;
          item.to = url;
          item.bytes_after = put(url, fs.readFileSync(src));
          item.note = 'WebP was not smaller; original kept';
        }
        const smallMeta = meta.sizes.find((s) => s.name === 'small');
        if (smallMeta && (smallMeta.width < meta.sizes[0].width)) {
          assetsSmall[k] = `${base}.small.webp`;
          item.small_bytes = put(assetsSmall[k], fs.readFileSync(path.join(cacheDir, `${key}.small.webp`)));
        }
      } else if (kind === 'video') {
        assets[k] = url;
        item.to = url;
        item.bytes_after = put(url, fs.readFileSync(src));
        if (settings.video_posters) {
          try {
            const buf = await cached(sha(h, 'poster', q), '.webp', async () => Buffer.from((await enc.poster(src)).data, 'base64'));
            posters[k] = `${base}.poster.webp`;
            item.poster_bytes = put(posters[k], buf);
          } catch (e) {
            notes.push(`${k}: no poster frame (${e.message})`);
          }
        }
      } else {
        // Audio (music, ambience, sfx, voice)
        const bitrate = settings.audio_bitrate?.[kind];
        let buf = fs.readFileSync(src);
        let to = url;
        if (ffmpeg && bitrate) {
          const out = await cached(sha(h, 'opus', bitrate), '.opus', async () => {
            const tmp = path.join(cacheDir, `tmp-${process.pid}.opus`);
            const r = spawnSync(ffmpeg, ['-y', '-v', 'error', '-i', src, '-vn', '-c:a', 'libopus', '-b:a', bitrate, tmp], { encoding: 'utf8' });
            if (r.status !== 0) throw new Error(`ffmpeg failed for ${k}: ${(r.stderr || '').trim().slice(0, 200)}`);
            const b = fs.readFileSync(tmp);
            fs.rmSync(tmp);
            return b;
          });
          if (out.length < buf.length) { buf = out; to = `${base}.opus`; item.bitrate = bitrate; }
        }
        assets[k] = to;
        item.to = to;
        item.bytes_after = put(to, buf);
      }
      items.push(item);
    }
  } finally {
    await enc.close();
  }
  const hasAudio = Object.keys(data.assets).some((k) => !IMAGE_KINDS.has(k.split(':')[0]) && !k.startsWith('video:'));
  if (!ffmpeg && hasAudio) notes.push('Audio copied as-is: ffmpeg not found (set optimize.ffmpeg in forge.yaml to re-encode to the target bitrates). ComfyUI audio is already Opus.');

  const { html } = renderBuild(root, { mode: 'release', mutate: (ctx) => ({ ...ctx, assets, assetsSmall, posters }) });
  writeText(path.join(outDir, 'index.html'), html);
  // Runtime data for the packager (it rewrites URLs again for hashed names or inlining).
  writeJson(path.join(buildDir, 'optimized.json'), { buildId: info.id, assets, assetsSmall, posters });

  const sum = (f) => items.reduce((n, i) => n + (i[f] || 0), 0);
  const report = {
    buildId: info.id,
    at: new Date().toISOString(),
    html_bytes: Buffer.byteLength(html),
    media_bytes_before: sum('bytes_before'),
    media_bytes_after: sum('bytes_after'),
    small_variant_bytes: sum('small_bytes'),
    poster_bytes: sum('poster_bytes'),
    ffmpeg: ffmpeg ? 'found' : 'not found',
    settings,
    items,
    notes,
  };
  writeJson(path.join(root, 'release', 'optimize.json'), report);
  log(`Optimized build ${info.id} -> build/optimized/`);
  return report;
}

export function formatOptimize(r) {
  const kb = (b) => `${Math.round(b / 1024)} KB`;
  const lines = [
    `Optimized build ${r.buildId}: HTML ${kb(r.html_bytes)}, media ${kb(r.media_bytes_before)} -> ${kb(r.media_bytes_after)}` +
      (r.media_bytes_before ? ` (${Math.round((1 - r.media_bytes_after / r.media_bytes_before) * 100)}% smaller)` : ''),
  ];
  if (r.small_variant_bytes) lines.push(`  + small image variants for phones: ${kb(r.small_variant_bytes)}`);
  if (r.poster_bytes) lines.push(`  + video posters: ${kb(r.poster_bytes)}`);
  for (const i of r.items) lines.push(`  ${i.key.padEnd(28)} ${kb(i.bytes_before).padStart(8)} -> ${kb(i.bytes_after).padStart(8)}${i.size ? `  ${i.size}` : ''}${i.note ? `  (${i.note})` : ''}`);
  for (const n of r.notes) lines.push(`  note: ${n}`);
  return lines.join('\n');
}
