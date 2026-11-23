// Performance QA: load + play the shipped game in headless Chromium (desktop, and phone emulation with
// a slowed CPU and a 4G-like network) and compare the results with forge.yaml performance budgets.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readJson, writeJson, writeText, listFiles } from '../lib/util.mjs';
import { loadProject } from '../lib/project.mjs';
import { serveStatic } from '../build/serve.mjs';
import { slugify } from '../release/package.mjs';

export const DEFAULT_PERFORMANCE = {
  budgets: {
    first_passage_ms: 2000, // phone profile: navigation start -> first passage on screen
    transition_ms: 100, // phone profile, 95th percentile: click -> next passage painted
    html_kb: 2048, // index.html (story + engine; media is separate)
    save_kb: 100, // largest save during the long session
    heap_growth_mb: 20, // JS heap growth over the long session
    total_mb: 100, // every file of the build
  },
  mobile: { cpu_slowdown: 4, download_kbps: 9000, upload_kbps: 1500, latency_ms: 150, width: 390, height: 844, scale: 3 },
  long_session: 500, // passage transitions (desktop profile) for the memory check
  mobile_transitions: 40,
};

const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
  return out;
};
export const performanceSettings = (config) => merge(DEFAULT_PERFORMANCE, config.performance || {});

function requirePlaywright(root) {
  try {
    return createRequire(path.join(root, 'package.json'))('playwright');
  } catch {
    throw new Error("Playwright isn't installed for this project. Run: node .forge/forge.mjs setup");
  }
}

export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/** Which build/dist folders to test. */
export function perfTargets(root, wanted = null) {
  const project = loadProject(root);
  const all = {
    optimized: { dir: path.join(project.paths.build, 'optimized'), index: 'index.html' },
    web: { dir: path.join(root, 'dist', 'web'), index: 'index.html' },
    'single-html': { dir: path.join(root, 'dist', 'single'), index: `${slugify(project.config.title)}.html` },
  };
  const names = wanted?.length ? wanted : Object.keys(all);
  const out = {};
  for (const n of names) {
    if (!all[n]) throw new Error(`Unknown performance target '${n}'. Targets: ${Object.keys(all).join(', ')}`);
    if (fs.existsSync(path.join(all[n].dir, all[n].index))) out[n] = all[n];
    else if (wanted?.length) throw new Error(`${n}: ${path.relative(root, path.join(all[n].dir, all[n].index))} not found (run forge optimize / forge package first)`);
  }
  if (!Object.keys(out).length) throw new Error('Nothing to test. Run: node .forge/forge.mjs optimize');
  return out;
}

/** Plays `n` random transitions in the page; restarts from the start passage at endings. */
const SESSION = async ({ n, start, seed }) => {
  const S = window.SugarCube;
  let a = seed >>> 0;
  const rand = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const turn = (fn) => new Promise((resolve) => {
    const t0 = window.__forgeTurn;
    fn();
    const until = Date.now() + 8000;
    (function poll() { if (window.__forgeTurn > t0 || Date.now() > until) resolve(window.__forgeTurn > t0); else setTimeout(poll, 0); })();
  });
  let restarts = 0, stuck = 0, maxSave = 0;
  // Restarting at an ending must also reset the story variables (an exhausted time budget would
  // otherwise send every restart straight back to the deadline passage).
  const initial = JSON.stringify(S.State.variables);
  const restart = () => {
    const v = S.State.variables;
    for (const k of Object.keys(v)) delete v[k];
    Object.assign(v, JSON.parse(initial));
    S.Engine.play(start);
  };
  const saveSize = () => {
    try {
      if (S.Save.base64 && S.Save.base64.save) return S.Save.base64.save().length;
      if (S.Save.serialize) return (S.Save.serialize() || '').length;
    } catch (e) { /* optional */ }
    return 0;
  };
  for (let i = 0; i < n; i++) {
    const p = S.Story.get(S.State.passage);
    const links = Array.from(document.querySelectorAll('#passages a[data-passage]'));
    if ((p && p.tags.includes('ending')) || !links.length) {
      restarts++;
      await turn(restart);
    } else if (!(await turn(() => links[Math.floor(rand() * links.length)].click()))) {
      stuck++;
      await turn(restart);
    }
    await frame();
    if (i % 25 === 0) maxSave = Math.max(maxSave, saveSize());
  }
  await frame();
  maxSave = Math.max(maxSave, saveSize());
  return { restarts, stuck, maxSave, transitions: window.__forgePerf.transitions.slice() };
};

async function metrics(cdp) {
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  const { metrics: m } = await cdp.send('Performance.getMetrics');
  const get = (k) => m.find((x) => x.name === k)?.value ?? null;
  return { heap: get('JSHeapUsedSize'), nodes: get('Nodes'), listeners: get('JSEventListeners') };
}

async function runProfile(browser, url, profile, s, start) {
  const mobile = profile === 'mobile';
  const m = s.mobile;
  const context = await browser.newContext(mobile ? { viewport: { width: m.width, height: m.height }, deviceScaleFactor: m.scale, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 768 } });
  await context.addInitScript(() => { window.__forgeQA = true; }); // minigames expose outcome links
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (mobile) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: m.latency_ms, downloadThroughput: (m.download_kbps * 1000) / 8, uploadThroughput: (m.upload_kbps * 1000) / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: m.cpu_slowdown });
  }
  try {
    await page.goto(url, { waitUntil: 'commit', timeout: 120000 });
    await page.waitForFunction(() => window.__forgePerf && window.__forgePerf.first !== null, null, { timeout: 120000, polling: 50 });
    // Let the first screen's images/audio start and finish (prefetch of the next images starts at ~300 ms).
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    const load = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const first = window.__forgePerf.first;
      const res = performance.getEntriesByType('resource').filter((r) => r.startTime <= first + 250);
      return {
        first_passage_ms: Math.round(first),
        first_screen_complete_ms: Math.round(Math.max(first, ...res.map((r) => r.responseEnd))),
        dom_content_loaded_ms: Math.round(nav.domContentLoadedEventEnd || 0),
        html_transfer_bytes: nav.transferSize || nav.encodedBodySize || null,
        first_screen_requests: res.length,
        first_screen_media_bytes: res.reduce((n, r) => n + (r.transferSize || r.encodedBodySize || 0), 0),
        first_screen_files: res.map((r) => r.name.split('/').slice(-2).join('/')),
      };
    });
    const n = mobile ? s.mobile_transitions : s.long_session;
    const before = await metrics(cdp);
    const sess = await page.evaluate(SESSION, { n, start, seed: 7 });
    const after = await metrics(cdp);
    return {
      profile,
      ...load,
      transitions: sess.transitions.length,
      transition_p50_ms: percentile(sess.transitions, 50),
      transition_p95_ms: percentile(sess.transitions, 95),
      transition_max_ms: sess.transitions.length ? Math.max(...sess.transitions) : null,
      restarts: sess.restarts,
      stuck: sess.stuck,
      save_bytes: sess.maxSave,
      heap_start_mb: before.heap !== null ? +(before.heap / 1048576).toFixed(1) : null,
      heap_end_mb: after.heap !== null ? +(after.heap / 1048576).toFixed(1) : null,
      heap_growth_mb: before.heap !== null && after.heap !== null ? +((after.heap - before.heap) / 1048576).toFixed(1) : null,
      dom_nodes_end: after.nodes,
      errors: [...new Set(errors)].slice(0, 10),
    };
  } finally {
    await context.close();
  }
}

/** Compare measurements with budgets. @returns findings [{severity, kind, target, message}] */
export function checkBudgets(target, results, files, s) {
  const b = s.budgets;
  const f = [];
  const add = (sev, kind, message) => f.push({ severity: sev, kind, target, message });
  const mob = results.find((r) => r.profile === 'mobile');
  const desk = results.find((r) => r.profile === 'desktop');
  if (b.first_passage_ms && mob && mob.first_passage_ms > b.first_passage_ms) add('S2', 'load-time', `First passage after ${mob.first_passage_ms} ms on the phone profile (budget ${b.first_passage_ms} ms)`);
  if (b.transition_ms && mob && mob.transition_p95_ms > b.transition_ms) add('S2', 'transition', `95th-percentile transition ${mob.transition_p95_ms} ms on the phone profile (budget ${b.transition_ms} ms)`);
  if (b.html_kb && files.html_bytes > b.html_kb * 1024) add('S2', 'html-size', `${files.index} is ${Math.round(files.html_bytes / 1024)} KB (budget ${b.html_kb} KB)`);
  if (b.total_mb && files.total_bytes > b.total_mb * 1048576) add('S2', 'total-size', `Build is ${(files.total_bytes / 1048576).toFixed(1)} MB (budget ${b.total_mb} MB)`);
  const save = Math.max(...results.map((r) => r.save_bytes || 0));
  if (b.save_kb && save > b.save_kb * 1024) add('S2', 'save-size', `Largest save ${Math.round(save / 1024)} KB (budget ${b.save_kb} KB) - lower runtime.history_max_states or keep fewer/lighter story variables`);
  if (b.heap_growth_mb && desk && desk.heap_growth_mb > b.heap_growth_mb) add('S2', 'memory', `JS heap grew ${desk.heap_growth_mb} MB over ${desk.transitions} transitions (budget ${b.heap_growth_mb} MB)`);
  for (const r of results) {
    for (const e of r.errors) add('S2', 'js-error', `${r.profile}: ${e}`);
    if (r.stuck) add('S3', 'stuck', `${r.profile}: ${r.stuck} click(s) did not navigate`);
  }
  return f;
}

export async function runPerformance(root, { targets = null, log = () => {} } = {}) {
  const project = loadProject(root);
  const s = performanceSettings(project.config);
  const info = readJson(path.join(project.paths.build, 'build-info.json'));
  if (!info) throw new Error('No build found. Run: node .forge/forge.mjs build');
  const { chromium } = requirePlaywright(root);
  const browser = await chromium.launch({ headless: true });
  const out = { buildId: info.id, at: new Date().toISOString(), settings: s, targets: {}, findings: [] };
  try {
    for (const [name, t] of Object.entries(perfTargets(root, targets))) {
      const all = listFiles(t.dir);
      const files = {
        index: t.index,
        html_bytes: fs.statSync(path.join(t.dir, t.index)).size,
        count: all.length,
        total_bytes: all.reduce((n, f) => n + fs.statSync(f).size, 0),
      };
      const { server, url } = await serveStatic(t.dir, { index: t.index });
      try {
        const results = [];
        for (const profile of ['desktop', 'mobile']) {
          log(`${name}: ${profile} profile`);
          results.push(await runProfile(browser, url + t.index, profile, s, info.start));
        }
        const findings = checkBudgets(name, results, files, s);
        out.targets[name] = { files, results, findings };
        out.findings.push(...findings);
      } finally {
        server.close();
      }
    }
  } finally {
    await browser.close();
  }
  const sev = { S1: 0, S2: 0, S3: 0, S4: 0 };
  for (const f of out.findings) sev[f.severity]++;
  out.summary = { ...sev, pass: sev.S1 === 0 && sev.S2 === 0 };
  const reportDir = path.join(project.paths.qa, 'reports', info.id);
  writeJson(path.join(reportDir, 'performance.json'), out);
  writeText(path.join(reportDir, 'performance.md'), performanceMarkdown(out));
  const sumFile = path.join(reportDir, 'summary.json');
  writeJson(sumFile, { ...readJson(sumFile, {}), buildId: info.id, performance: out.summary });
  out.file = path.join(reportDir, 'performance.md');
  return out;
}

export function performanceMarkdown(r) {
  const b = r.settings.budgets;
  const m = r.settings.mobile;
  const kb = (x) => (x === null || x === undefined ? 'n/a' : `${Math.round(x / 1024)} KB`);
  const mark = (ok) => (ok ? '✅' : '❌');
  const lines = [
    `# Performance QA — build ${r.buildId}`,
    '',
    `**Result:** ${r.summary.pass ? 'PASS' : 'FAIL'} · S1 ${r.summary.S1} · S2 ${r.summary.S2} · S3 ${r.summary.S3} · S4 ${r.summary.S4}`,
    '',
    `Profiles: **desktop** (1366×768, no throttling, ${r.settings.long_session}-transition session for memory) and **phone** (${m.width}×${m.height} @${m.scale}x, CPU ${m.cpu_slowdown}× slower, ${m.download_kbps / 1000} Mbps down / ${m.latency_ms} ms latency, ${r.settings.mobile_transitions} transitions). Cache disabled.`,
    '',
  ];
  for (const [name, t] of Object.entries(r.targets)) {
    const mob = t.results.find((x) => x.profile === 'mobile');
    const desk = t.results.find((x) => x.profile === 'desktop');
    const save = Math.max(...t.results.map((x) => x.save_bytes || 0));
    lines.push(
      `## ${name}`,
      '',
      '| Check | Budget | Phone | Desktop | |',
      '|---|---|---|---|---|',
      `| First passage on screen | ${b.first_passage_ms} ms | ${mob.first_passage_ms} ms | ${desk.first_passage_ms} ms | ${mark(!b.first_passage_ms || mob.first_passage_ms <= b.first_passage_ms)} |`,
      `| Transition (p95) | ${b.transition_ms} ms | ${mob.transition_p95_ms ?? 'n/a'} ms | ${desk.transition_p95_ms ?? 'n/a'} ms | ${mark(!b.transition_ms || (mob.transition_p95_ms ?? 0) <= b.transition_ms)} |`,
      `| Transition (median / max) | | ${mob.transition_p50_ms ?? 'n/a'} / ${mob.transition_max_ms ?? 'n/a'} ms | ${desk.transition_p50_ms ?? 'n/a'} / ${desk.transition_max_ms ?? 'n/a'} ms | |`,
      `| ${t.files.index} size | ${b.html_kb} KB | ${kb(t.files.html_bytes)} | | ${mark(!b.html_kb || t.files.html_bytes <= b.html_kb * 1024)} |`,
      `| Whole build | ${b.total_mb} MB | ${(t.files.total_bytes / 1048576).toFixed(1)} MB in ${t.files.count} files | | ${mark(!b.total_mb || t.files.total_bytes <= b.total_mb * 1048576)} |`,
      `| Largest save | ${b.save_kb} KB | ${kb(save)} | | ${mark(!b.save_kb || save <= b.save_kb * 1024)} |`,
      `| JS heap growth | ${b.heap_growth_mb} MB | | ${desk.heap_growth_mb ?? 'n/a'} MB over ${desk.transitions} transitions (${desk.heap_start_mb} → ${desk.heap_end_mb} MB) | ${mark(!b.heap_growth_mb || (desk.heap_growth_mb ?? 0) <= b.heap_growth_mb)} |`,
      `| DOM nodes at end | | ${mob.dom_nodes_end ?? 'n/a'} | ${desk.dom_nodes_end ?? 'n/a'} | |`,
      `| First screen fully loaded (images, audio) | | ${mob.first_screen_complete_ms} ms | ${desk.first_screen_complete_ms} ms | |`,
      `| First-screen downloads | | ${mob.first_screen_requests} requests, ${kb(mob.first_screen_media_bytes)}${mob.first_screen_files.length ? ` (${mob.first_screen_files.join(', ')})` : ''} | ${desk.first_screen_requests} requests, ${kb(desk.first_screen_media_bytes)} | |`,
      '',
    );
    if (t.findings.length) lines.push('| Sev | Kind | Detail |', '|---|---|---|', ...t.findings.map((f) => `| ${f.severity} | ${f.kind} | ${String(f.message).replace(/\|/g, '\\|')} |`), '');
  }
  lines.push('## Notes', '', '- Budgets come from `forge.yaml → performance.budgets`; the phone profile settings from `performance.mobile`.', '- Timings come from in-game hooks (`window.__forgePerf`): first passage = navigation start → first passage painted; transition = click → next passage painted.', '- Fix routing: size problems → perf-optimizer (`forge optimize` settings); save size → runtime.history_max_states / loop-designer; slow transitions or memory growth → game-builder.', '');
  return lines.join('\n');
}
