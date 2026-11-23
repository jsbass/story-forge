// Engines: the adapter registry (what Twine Forge can build) and the Engine Advisor's fit check
// (which engine suits this design). See docs/engines.md for the adapter contract.
import fs from 'node:fs';
import path from 'node:path';
import { readText, listFiles } from '../lib/util.mjs';
import { PLUGIN_ROOT, loadProject } from '../lib/project.mjs';
import { updateYamlBlock, readYaml } from '../lib/yaml.mjs';
import { build as sugarcubeBuild, compileScripts } from '../build/builder.mjs';

/**
 * Adapters: one per engine Twine Forge can build. An adapter turns the engine-neutral project
 * (design/, characters/, script/*.script.md, assets/manifest.yaml, loops) into build/<mode>/ and
 * build/build-info.json, and says which QA and packaging steps apply to its output.
 */
export const ADAPTERS = {
  sugarcube: {
    id: 'sugarcube',
    label: 'SugarCube 2 (Twine)',
    build: (root, opts) => sugarcubeBuild(root, opts),
    qa: { static: true, functional: true, performance: true, character: true },
    packaging: ['itch', 'single-html', 'web', 'desktop'],
    loopModules: 'modules/',
  },
};

export function loadEngineCatalog() {
  return JSON.parse(readText(path.join(PLUGIN_ROOT, 'engines.json')));
}

/** The adapter for this project (forge.yaml engine.name, default sugarcube). */
export function engineFor(config) {
  const name = config?.engine?.name || 'sugarcube';
  const a = ADAPTERS[name];
  if (a) return a;
  const cat = loadEngineCatalog().engines[name];
  throw new Error(cat
    ? `forge.yaml engine '${name}' (${cat.label}) is ${cat.forge_support} in Twine Forge - no build adapter yet. Supported: ${Object.keys(ADAPTERS).join(', ')}`
    : `Unknown engine '${name}' in forge.yaml. Known: ${Object.keys(loadEngineCatalog().engines).join(', ')}`);
}

// Words in the design docs that signal features a hypertext engine handles poorly.
const SIGNALS = {
  realtime_action: /\b(real[- ]?time (combat|action|battles?)|reflex(es)?|twitch|platform(er|ing)|shoot(er|ing)|bullet[- ]hell|dodg(e|ing) (attacks|bullets)|action combat|quick[- ]time events?)\b/i,
  physics: /\b(physics|ragdoll|projectile arcs?|rigid ?bod(y|ies))\b/i,
  free_movement: /\b(open[- ]world|free (roam|movement)|walk around (the|a) (map|town|world)|tile[- ]?map|top[- ]down movement|wasd)\b/i,
  '3d': /\b(3d|three[- ]dimensional|first[- ]person (view|camera)|third[- ]person camera)\b/i,
  multiplayer: /\b(multiplayer|co-?op|online play|pvp|networked)\b/i,
  realtime_timers: /\b(timed choices?|countdown|real[- ]time timers?|choose before the timer)\b/i,
  sprites_layered: /\b(visual novel|sprite(s)? (on|in) screen|character sprites|expressions? layered)\b/i,
};
const MODULE_FEATURES = { stats: 'stats', inventory: 'inventory', minigame: 'turn_based_minigames', explore: 'hub_map' };

/** What the project's design asks for: {feature: [reasons]} */
export function detectNeeds(root) {
  const project = loadProject(root);
  const needs = {};
  const need = (f, why) => { (needs[f] ||= []).includes(why) || needs[f].push(why); };
  need('branching_text', 'interactive fiction');

  for (const m of project.loops.modules || []) {
    if (MODULE_FEATURES[m.type]) need(MODULE_FEATURES[m.type], `loop module ${m.id} (${m.type})`);
    else need('turn_based_minigames', `loop module ${m.id} (${m.type})`);
  }
  for (const d of listFiles(path.join(root, 'design', 'loops'), (f) => f.endsWith('.md'))) {
    if (/needs-module/i.test(readText(d))) need('turn_based_minigames', `${path.relative(root, d).replace(/\\/g, '/')} needs a custom module`);
  }

  const docs = [path.join(root, 'design', 'interview.md'), path.join(root, 'design', 'story-bible.md'), ...listFiles(path.join(root, 'design', 'loops'), (f) => f.endsWith('.md'))].filter((f) => fs.existsSync(f));
  for (const f of docs) {
    const text = readText(f);
    for (const [feature, re] of Object.entries(SIGNALS)) {
      const m = re.exec(text);
      if (m) need(feature, `"${m[0]}" in ${path.relative(root, f).replace(/\\/g, '/')}`);
    }
  }

  if (project.config.voice_over) need('voice_over', 'voice_over: true in forge.yaml');
  const manifest = readYaml(path.join(root, 'assets', 'manifest.yaml'), root);
  if ((manifest?.assets || []).some((a) => a.kind === 'video' && !a.unused)) need('video', 'video cues in the script');
  for (const t of project.config.distribution || []) {
    if (['itch', 'web', 'single-html'].includes(t)) need('web', `distribution: ${t}`);
    if (t === 'desktop') need('desktop', 'distribution: desktop');
    if (t === 'mobile') need('mobile_app', 'distribution: mobile');
  }

  // Size: scripts if they exist, otherwise the branch map's scene count.
  let passages = 0;
  try { passages = compileScripts(project).results.reduce((n, r) => n + r.passages.length, 0); } catch { /* scripts may not exist yet */ }
  if (!passages) passages = (project.branchMap?.acts || []).reduce((n, a) => n + (a.scenes || []).length, 0);
  if (passages > 1500) need('large_story', `${passages} passages`);
  return { needs, passages };
}

/** Score every engine against the needs. */
export function fitReport(needs) {
  const cat = loadEngineCatalog();
  const rows = Object.entries(cat.engines).map(([id, e]) => {
    const blockers = [];
    const risks = [];
    for (const f of Object.keys(needs)) {
      const v = e.fit[f] || 'no';
      if (v === 'no') blockers.push(f);
      else if (v === 'partial') risks.push(f);
    }
    return { id, label: e.label, forge_support: e.forge_support, buildable: !!ADAPTERS[id], blockers, risks, notes: e.notes || {}, summary: e.summary };
  });
  rows.sort((a, b) => a.blockers.length - b.blockers.length || a.risks.length - b.risks.length || Number(b.buildable) - Number(a.buildable));
  const buildable = rows.filter((r) => r.buildable);
  const best = buildable.find((r) => !r.blockers.length) || null;
  const alternatives = rows.filter((r) => !r.buildable && !r.blockers.length && (!best || r.risks.length < best.risks.length));
  return { rows, recommended: best ? best.id : null, alternatives: alternatives.map((r) => r.id), features: cat.features };
}

export function formatFit(needs, passages, report) {
  const lines = ['Design needs:'];
  for (const [f, why] of Object.entries(needs)) lines.push(`  ${f.padEnd(22)} ${why.slice(0, 3).join('; ')}${why.length > 3 ? ' ...' : ''}`);
  if (passages) lines.push(`  (${passages} passages)`);
  lines.push('', 'Engines (best fit first):');
  for (const r of report.rows) {
    const tag = r.buildable ? 'buildable' : r.forge_support;
    lines.push(`  ${r.label.padEnd(24)} [${tag}]  ${r.blockers.length ? `blockers: ${r.blockers.join(', ')}` : 'no blockers'}${r.risks.length ? `; risks: ${r.risks.join(', ')}` : ''}`);
  }
  lines.push('');
  if (report.recommended) {
    const r = report.rows.find((x) => x.id === report.recommended);
    lines.push(`Recommended: ${r.label}.`);
    for (const f of r.risks) lines.push(`  risk ${f}: ${r.notes[f] || report.features[f]}`);
  } else {
    lines.push('No buildable engine covers this design. Rework the blockers (e.g. turn-based instead of real-time), or plan for another engine:');
  }
  if (report.alternatives.length) lines.push(`Also a good fit, not buildable by Twine Forge yet: ${report.alternatives.map((id) => report.rows.find((r) => r.id === id).label).join(', ')}`);
  return lines.join('\n');
}

/** Record the decision in forge.yaml → engine (only buildable engines). */
export function setEngine(root, name, { rationale = '', risks = [] } = {}) {
  engineFor({ engine: { name } }); // throws for engines without an adapter
  updateYamlBlock(path.join(root, 'forge.yaml'), root, 'engine', (doc) => {
    doc.setIn(['engine', 'name'], name);
    if (rationale) doc.setIn(['engine', 'rationale'], rationale);
    doc.setIn(['engine', 'risks'], risks);
    doc.setIn(['engine', 'checked'], new Date().toISOString().slice(0, 10));
  });
}
