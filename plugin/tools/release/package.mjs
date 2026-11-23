// Packager: build/optimized -> dist/{itch,single,web,desktop}.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readJson, writeJson, writeText, listFiles, rmrf, toPosix } from '../lib/util.mjs';
import { loadProject } from '../lib/project.mjs';
import { renderBuild } from '../build/builder.mjs';
import { createZip } from '../lib/zip.mjs';

export const TARGETS = ['itch', 'single-html', 'web', 'desktop'];

/** itch.io HTML5 ZIP rules (itch.io/docs/creators/html5, checked 2026-11-23). */
export const ITCH_LIMITS = { files: 1000, total_bytes: 500 * 1024 * 1024, file_bytes: 200 * 1024 * 1024, path_chars: 240 };

export const DEFAULT_DISTRIBUTION = {
  single_html_max_mb: 25, // above this the single-HTML target fails (unless --force)
  desktop: { platforms: ['win32'], arch: 'x64', electron: 'latest', width: 1280, height: 800 },
  itch: { project: null, channel: 'html5' }, // project "user/game" for `butler push`
};

const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.opus': 'audio/ogg', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webm': 'video/webm', '.mp4': 'video/mp4' };

export const slugify = (s) => String(s || 'game').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game';

export function distributionSettings(config) {
  const d = config.distribution_settings || {};
  return {
    ...DEFAULT_DISTRIBUTION,
    ...d,
    desktop: { ...DEFAULT_DISTRIBUTION.desktop, ...(d.desktop || {}) },
    itch: { ...DEFAULT_DISTRIBUTION.itch, ...(d.itch || {}) },
  };
}

function loadOptimized(root) {
  const project = loadProject(root);
  const b = project.paths.build;
  const info = readJson(path.join(b, 'build-info.json'));
  const opt = readJson(path.join(b, 'optimized.json'));
  if (!opt || !fs.existsSync(path.join(b, 'optimized', 'index.html'))) throw new Error('No optimized build. Run: node .forge/forge.mjs optimize');
  if (opt.buildId !== info.id) throw new Error(`build/optimized is from build ${opt.buildId} but the last build is ${info.id}. Run: node .forge/forge.mjs optimize`);
  return { project, info, opt, dir: path.join(b, 'optimized') };
}

/** Every file of a directory as {name (posix, relative), abs, bytes}. */
function filesOf(dir) {
  return listFiles(dir).map((abs) => ({ name: toPosix(path.relative(dir, abs)), abs, bytes: fs.statSync(abs).size }));
}

/** URLs the runtime will request, checked case-sensitively against the files that ship. */
export function checkReferences(files, opt) {
  const names = new Set(files.map((f) => f.name));
  const urls = [...Object.values(opt.assets), ...Object.values(opt.assetsSmall || {}), ...Object.values(opt.posters || {})];
  const problems = [];
  for (const u of urls) {
    if (/^(\/|[a-z]+:)/i.test(u)) problems.push(`${u}: not a relative path`);
    else if (!names.has(u)) {
      const ci = [...names].find((n) => n.toLowerCase() === u.toLowerCase());
      problems.push(ci ? `${u}: case differs from the file (${ci}) - breaks on itch.io and Linux servers` : `${u}: file missing`);
    }
  }
  return problems;
}

export function itchChecks(files) {
  const problems = [];
  const total = files.reduce((n, f) => n + f.bytes, 0);
  if (!files.some((f) => f.name === 'index.html')) problems.push('index.html must be in the ZIP root');
  if (files.length > ITCH_LIMITS.files) problems.push(`${files.length} files (itch.io allows ${ITCH_LIMITS.files})`);
  if (total > ITCH_LIMITS.total_bytes) problems.push(`${(total / 1048576).toFixed(1)} MB extracted (itch.io allows 500 MB)`);
  for (const f of files) {
    if (f.bytes > ITCH_LIMITS.file_bytes) problems.push(`${f.name}: ${(f.bytes / 1048576).toFixed(1)} MB (itch.io allows 200 MB per file)`);
    if (f.name.length > ITCH_LIMITS.path_chars) problems.push(`${f.name}: path longer than ${ITCH_LIMITS.path_chars} characters`);
  }
  return { problems, total };
}

// ---------------------------------------------------------------- targets

function packageItch(root, ctx) {
  const files = filesOf(ctx.dir);
  const { problems, total } = itchChecks(files);
  problems.push(...checkReferences(files, ctx.opt));
  if (problems.length) throw new Error(`itch.io ZIP checks failed:\n  ${problems.join('\n  ')}`);
  const zip = createZip(files.map((f) => ({ name: f.name, data: fs.readFileSync(f.abs) })));
  const out = path.join(root, 'dist', 'itch', `${ctx.slug}-${ctx.version}-html5.zip`);
  rmrf(path.dirname(out));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, zip);
  return { file: toPosix(path.relative(root, out)), bytes: zip.length, files: files.length, extracted_bytes: total };
}

function packageSingle(root, ctx, { force = false } = {}) {
  const inline = (u) => {
    const f = path.join(ctx.dir, u);
    return `data:${MIME[path.extname(f).toLowerCase()] || 'application/octet-stream'};base64,${fs.readFileSync(f).toString('base64')}`;
  };
  const map = (m) => Object.fromEntries(Object.entries(m || {}).map(([k, u]) => [k, inline(u)]));
  // One copy of each image only: the full-size version (the small variants would double the size).
  const { html } = renderBuild(root, { mode: 'release', mutate: (c) => ({ ...c, assets: map(ctx.opt.assets), assetsSmall: {}, posters: map(ctx.opt.posters) }) });
  const bytes = Buffer.byteLength(html);
  const max = ctx.dist.single_html_max_mb * 1048576;
  const videos = Object.keys(ctx.opt.assets).filter((k) => k.startsWith('video:'));
  const warnings = [];
  if (videos.length) warnings.push(`${videos.length} video(s) inlined as base64 (${videos.join(', ')}) - the itch or web target suits video better`);
  if (bytes > max) {
    const msg = `single HTML is ${(bytes / 1048576).toFixed(1)} MB, over distribution_settings.single_html_max_mb (${ctx.dist.single_html_max_mb} MB)`;
    if (!force) throw new Error(`${msg}. Drop the single-html target, raise the limit, or pass --force.`);
    warnings.push(msg);
  }
  const out = path.join(root, 'dist', 'single', `${ctx.slug}.html`);
  rmrf(path.dirname(out));
  writeText(out, html);
  return { file: toPosix(path.relative(root, out)), bytes, warnings };
}

function packageWeb(root, ctx) {
  const outDir = path.join(root, 'dist', 'web');
  rmrf(outDir);
  const rename = {};
  for (const f of filesOf(ctx.dir)) {
    if (f.name === 'index.html') continue;
    const data = fs.readFileSync(f.abs);
    const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 10);
    const ext = path.posix.extname(f.name);
    const hashed = `${f.name.slice(0, -ext.length)}.${hash}${ext}`;
    rename[f.name] = hashed;
    fs.mkdirSync(path.dirname(path.join(outDir, hashed)), { recursive: true });
    fs.writeFileSync(path.join(outDir, hashed), data);
  }
  const map = (m) => Object.fromEntries(Object.entries(m || {}).map(([k, u]) => [k, rename[u] || u]));
  const { html } = renderBuild(root, { mode: 'release', mutate: (c) => ({ ...c, assets: map(ctx.opt.assets), assetsSmall: map(ctx.opt.assetsSmall), posters: map(ctx.opt.posters) }) });
  writeText(path.join(outDir, 'index.html'), html);
  // Hosting hints: hashed media can be cached forever; index.html must always be revalidated.
  writeText(path.join(outDir, '_headers'), '/media/*\n  Cache-Control: public, max-age=31536000, immutable\n/index.html\n  Cache-Control: no-cache\n');
  const files = filesOf(outDir);
  return { dir: toPosix(path.relative(root, outDir)), files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0) };
}

export function electronMain({ productName, width, height }) {
  return `// Generated by Twine Forge - desktop wrapper for the web build in ./game
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');

// Saves (SugarCube uses localStorage) live in the per-user data folder named after the app.
app.setName(${JSON.stringify(productName)});

function createWindow() {
  const win = new BrowserWindow({
    width: ${width},
    height: ${height},
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#111111',
    title: ${JSON.stringify(productName)},
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  const external = (url) => { if (/^https?:/i.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); external(url); } });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.key === 'Enter' && input.alt))) {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
  });
  win.loadFile(path.join(__dirname, 'game', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
`;
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status})`);
}

/**
 * Desktop: always writes the Electron app source (dist/desktop/app). With build=true it installs
 * Electron + @electron/packager there (a ~100 MB download - only after the user approves) and builds
 * dist/desktop/<platform>.
 */
function packageDesktop(root, ctx, { build = false, log = console.log } = {}) {
  const d = ctx.dist.desktop;
  const appDir = path.join(root, 'dist', 'desktop', 'app');
  const gameDir = path.join(appDir, 'game');
  rmrf(gameDir);
  for (const f of filesOf(ctx.dir)) {
    fs.mkdirSync(path.dirname(path.join(gameDir, f.name)), { recursive: true });
    fs.copyFileSync(f.abs, path.join(gameDir, f.name));
  }
  const pkgFile = path.join(appDir, 'package.json');
  const prev = readJson(pkgFile, {});
  writeJson(pkgFile, {
    name: ctx.slug,
    productName: ctx.title,
    version: ctx.version,
    description: `${ctx.title} (desktop)`,
    main: 'main.js',
    private: true,
    devDependencies: prev.devDependencies || {},
  });
  writeText(path.join(appDir, 'main.js'), electronMain({ productName: ctx.title, width: d.width, height: d.height }));
  const result = { app: toPosix(path.relative(root, appDir)), builds: [] };
  if (!build) {
    result.note = 'App source written. Building the executables downloads Electron (~100 MB): run `forge package desktop --build --yes` after approval.';
    return result;
  }
  if (!fs.existsSync(path.join(appDir, 'node_modules', 'electron')) || !fs.existsSync(path.join(appDir, 'node_modules', '@electron', 'packager'))) {
    log(`Installing electron@${d.electron} and @electron/packager into ${result.app}`);
    run('npm', ['install', '--save-dev', '--no-audit', '--no-fund', `electron@${d.electron}`, '@electron/packager@latest'], appDir);
  }
  for (const platform of d.platforms) {
    const out = path.join(root, 'dist', 'desktop');
    run('npx', ['--no-install', 'electron-packager', '.', JSON.stringify(ctx.title), `--platform=${platform}`, `--arch=${d.arch}`, `--out=${JSON.stringify(out)}`, '--overwrite', '--asar', '--ignore=^/node_modules'], appDir);
    const dir = fs.readdirSync(out).find((n) => n.endsWith(`-${platform}-${d.arch}`));
    if (dir) {
      const files = listFiles(path.join(out, dir));
      result.builds.push({ platform, arch: d.arch, dir: toPosix(path.relative(root, path.join(out, dir))), bytes: files.reduce((n, f) => n + fs.statSync(f).size, 0) });
    }
  }
  return result;
}

/** Keep dist/ out of git in projects created before Phase 3. */
function ensureIgnored(root) {
  const f = path.join(root, '.gitignore');
  const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  if (!/^dist\/?$/m.test(text)) fs.writeFileSync(f, `${text.replace(/\n?$/, '\n')}dist/\n`);
}

/**
 * Package the optimized build.
 * @param {string[]} targets  subset of TARGETS (default: forge.yaml distribution)
 */
export function packageGame(root, { targets = null, force = false, buildDesktop = false, log = console.log } = {}) {
  const ctx = loadOptimized(root);
  const cfg = ctx.project.config;
  const wanted = targets?.length ? targets : cfg.distribution || TARGETS;
  const unknown = wanted.filter((t) => !TARGETS.includes(t));
  if (unknown.length) throw new Error(`Unknown target(s): ${unknown.join(', ')}. Targets: ${TARGETS.join(', ')}`);
  Object.assign(ctx, { title: cfg.title || 'Untitled', slug: slugify(cfg.title), version: String(cfg.version || '1.0.0'), dist: distributionSettings(cfg) });
  ensureIgnored(root);

  const results = {};
  const errors = {};
  for (const t of wanted) {
    try {
      log(`packaging ${t}...`);
      if (t === 'itch') results[t] = packageItch(root, ctx);
      if (t === 'single-html') results[t] = packageSingle(root, ctx, { force });
      if (t === 'web') results[t] = packageWeb(root, ctx);
      if (t === 'desktop') results[t] = packageDesktop(root, ctx, { build: buildDesktop, log });
    } catch (e) {
      errors[t] = e.message;
    }
  }
  const release = { buildId: ctx.info.id, version: ctx.version, at: new Date().toISOString(), targets: results, errors };
  const prev = readJson(path.join(root, 'release', 'release.json'), {});
  // Keep earlier desktop executables listed if this run only rewrote the app source.
  if (results.desktop && !results.desktop.builds.length && prev.targets?.desktop?.builds?.length && prev.buildId === ctx.info.id) results.desktop.builds = prev.targets.desktop.builds;
  writeJson(path.join(root, 'release', 'release.json'), release);
  return release;
}

/** `butler push` for the itch target. Publishing is outward-facing: callers pass yes only after the user approves. */
export function butlerPush(root, { project, channel, yes = false }) {
  const rel = readJson(path.join(root, 'release', 'release.json'));
  const zip = rel?.targets?.itch?.file;
  if (!zip) throw new Error('No itch.io package. Run: node .forge/forge.mjs package itch');
  if (!project) throw new Error('Set distribution_settings.itch.project (e.g. "yourname/your-game") or pass --project');
  const cmd = ['butler', ['push', zip, `${project}:${channel}`, '--userversion', rel.version]];
  if (!yes) return { command: `${cmd[0]} ${cmd[1].join(' ')}`, ran: false };
  run(cmd[0], cmd[1], root);
  return { command: `${cmd[0]} ${cmd[1].join(' ')}`, ran: true };
}

export function formatRelease(r) {
  const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;
  const lines = [`Release ${r.version} (build ${r.buildId})`];
  const t = r.targets;
  if (t.itch) lines.push(`  itch         ${t.itch.file}  ${mb(t.itch.bytes)} zipped, ${t.itch.files} files`);
  if (t['single-html']) lines.push(`  single-html  ${t['single-html'].file}  ${mb(t['single-html'].bytes)}${t['single-html'].warnings.map((w) => `\n               warning: ${w}`).join('')}`);
  if (t.web) lines.push(`  web          ${t.web.dir}/  ${t.web.files} files, ${mb(t.web.bytes)}`);
  if (t.desktop) {
    lines.push(`  desktop      ${t.desktop.app}/ (Electron app source)`);
    for (const b of t.desktop.builds) lines.push(`               ${b.platform}-${b.arch}: ${b.dir}  ${mb(b.bytes)}`);
    if (t.desktop.note) lines.push(`               ${t.desktop.note}`);
  }
  for (const [k, e] of Object.entries(r.errors)) lines.push(`  ${k.padEnd(12)} FAILED: ${e}`);
  return lines.join('\n');
}
