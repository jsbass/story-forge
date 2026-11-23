// Automated playthroughs of build/dev/index.html with Playwright (installed per project by `forge setup`).
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { shortestPath } from './static.mjs';

function requirePlaywright(root) {
  try {
    return createRequire(path.join(root, 'package.json'))('playwright');
  } catch {
    throw new Error("Playwright isn't installed for this project. Run: node .forge/forge.mjs setup");
  }
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const READ_STATE = () => {
  const S = window.SugarCube;
  const p = S.State.passage;
  const story = S.Story.get(p);
  const inv = (S.setup.forge && S.setup.forge.invariants) || [];
  const v = S.State.variables;
  return {
    passage: p,
    tags: (story && story.tags) || [],
    turn: window.__forgeTurn || 0,
    violations: inv.filter((i) => typeof v[i.var] === 'number' && (v[i.var] < i.min || v[i.var] > i.max)).map((i) => `$${i.var}=${v[i.var]} outside [${i.min}, ${i.max}]`),
    errors: Array.from(document.querySelectorAll('#passages .error-view, #passages .error')).map((e) => e.textContent.trim()).slice(0, 3),
    links: Array.from(document.querySelectorAll('#passages a[data-passage]')).map((a) => ({ to: a.getAttribute('data-passage'), label: a.textContent.trim() })),
  };
};

const SAVE_ROUNDTRIP = async () => {
  const S = window.SugarCube;
  // Key-order-independent snapshot: SugarCube's save format may reorder object keys.
  const stable = (x) => Array.isArray(x) ? x.map(stable)
    : x && typeof x === 'object' ? Object.keys(x).sort().reduce((o, k) => { o[k] = stable(x[k]); return o; }, {}) : x;
  const snap = () => JSON.stringify(stable({ p: S.State.passage, v: S.State.variables }));
  const before = snap();
  let size = null;
  try {
    if (S.Save.base64 && S.Save.base64.save) size = S.Save.base64.save().length;
    else if (S.Save.serialize) size = (S.Save.serialize() || '').length;
  } catch (e) { /* size optional */ }
  try {
    if (S.Save.browser && S.Save.browser.slot) {
      await S.Save.browser.slot.save(0);
      await S.Save.browser.slot.load(0);
    } else if (S.Save.slots) {
      S.Save.slots.save(0);
      S.Save.slots.load(0);
    } else return { skipped: 'no save API found' };
    // Loading restores the moment; re-render as the Saves dialog does, so passage-time code re-runs.
    S.Engine.show();
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  }
  await new Promise((r) => setTimeout(r, 150));
  return { before, after: snap(), size };
};

/**
 * @param {string} root project root
 * @param {object} o
 * @param {object} o.graph        static graph from analyzeStatic()
 * @param {string} o.html         path to dev build
 * @param {number} [o.walks=60]   random walks after the directed ones
 * @param {number} [o.maxSteps=150]
 */
export async function runWalks(root, { graph, html, walks = 60, maxSteps = 150, seed = 1, saveEvery = 7, log = () => {} }) {
  const { chromium } = requirePlaywright(root);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const url = pathToFileURL(html).href;
  const rand = rng(seed);

  const visited = new Set();
  const linksTaken = new Set();
  const endingsReached = new Set();
  const findings = [];
  const seen = new Set();
  const add = (severity, kind, passage, message, route) => {
    const key = `${kind}|${passage}|${String(message).split('<<')[0].slice(0, 80)}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ severity, kind, passage, message, route: route ? route.slice(-12) : undefined });
  };
  let maxSaveSize = 0;
  let walksRun = 0;

  async function playthrough(plan) {
    walksRun++;
    const page = await context.newPage();
    const route = [];
    page.on('pageerror', (e) => add('S2', 'js-error', route[route.length - 1] || null, String(e.message || e), route));
    page.on('console', (m) => { if (m.type() === 'error') add('S2', 'console-error', route[route.length - 1] || null, m.text(), route); });
    try {
      await page.goto(url);
      await page.waitForFunction(() => window.SugarCube && window.SugarCube.State && window.SugarCube.State.passage, null, { timeout: 15000 });
      for (let step = 0; step < maxSteps; step++) {
        const s = await page.evaluate(READ_STATE);
        route.push(s.passage);
        visited.add(s.passage);
        for (const e of s.errors) add('S2', 'macro-error', s.passage, e, route);
        for (const v of s.violations) add('S2', 'invariant', s.passage, v, route);
        if (s.tags.includes('ending')) { endingsReached.add(s.passage); break; }
        if (!s.links.length) { add('S2', 'runtime-dead-end', s.passage, 'No available choices (all hidden by conditions?)', route); break; }

        if (saveEvery && step > 0 && (step === 1 || step % saveEvery === 0)) {
          const r = await page.evaluate(SAVE_ROUNDTRIP);
          if (r.error) add('S2', 'save-load', s.passage, `Save/load failed: ${r.error}`, route);
          else if (r.skipped) add('S4', 'save-load', null, r.skipped);
          else {
            if (r.size) maxSaveSize = Math.max(maxSaveSize, r.size);
            if (r.before !== r.after) add('S2', 'save-load', s.passage, 'State differs after save/load round-trip', route);
          }
        }

        let idx = -1;
        const wanted = plan && plan[step + 1];
        if (wanted) idx = s.links.findIndex((l) => l.to === wanted);
        if (idx < 0) {
          const fresh = s.links.map((l, i) => [l, i]).filter(([l]) => !visited.has(l.to) || !linksTaken.has(`${s.passage}->${l.to}`));
          const pool = fresh.length && rand() < 0.8 ? fresh : s.links.map((l, i) => [l, i]);
          idx = pool[Math.floor(rand() * pool.length)][1];
        }
        const target = s.links[idx];
        linksTaken.add(`${s.passage}->${target.to}`);
        await page.locator('#passages a[data-passage]').nth(idx).click();
        try {
          await page.waitForFunction((t) => (window.__forgeTurn || 0) > t, s.turn, { timeout: 5000 });
        } catch {
          add('S2', 'stuck', s.passage, `Clicking '${target.label}' did not navigate`, route);
          break;
        }
        if (step === maxSteps - 1) add('S3', 'long-walk', s.passage, `No ending within ${maxSteps} steps (possible loop)`, route);
      }
    } finally {
      await page.close();
    }
    return route;
  }

  // 1. Directed: aim for every ending via its shortest static path.
  for (const ending of graph.endings) {
    const plan = shortestPath(graph, graph.start, ending);
    if (!plan) continue;
    log(`directed walk -> ${ending}`);
    await playthrough(plan);
  }
  // 2. Coverage-guided random walks.
  for (let i = 0; i < walks; i++) await playthrough(null);

  await browser.close();
  for (const e of graph.endings) if (!endingsReached.has(e)) add('S2', 'ending-not-reached', e, 'No automated playthrough reached this ending (check conditions or add walks)');

  const total = graph.nodes.length;
  const covered = graph.nodes.filter((n) => visited.has(n)).length;
  const order = { S1: 0, S2: 1, S3: 2, S4: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    walks: walksRun,
    coverage: { passages: covered, total, percent: total ? Math.round((covered / total) * 100) : 0, unvisited: graph.nodes.filter((n) => !visited.has(n)) },
    links: { taken: linksTaken.size, total: new Set(graph.edges.filter((e) => e.kind !== 'include').map((e) => `${e.from}->${e.to}`)).size },
    endings: { reached: [...endingsReached], total: graph.endings.length },
    maxSaveBytes: maxSaveSize || null,
    findings,
  };
}
