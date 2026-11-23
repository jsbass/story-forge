// QA orchestration + markdown reports in qa/reports/<buildId>/
import fs from 'node:fs';
import path from 'node:path';
import { readJson, readText, writeJson, writeText } from '../lib/util.mjs';
import { loadProject } from '../lib/project.mjs';
import { parseTwee } from '../build/twee.mjs';
import { analyzeStatic } from './static.mjs';
import { runWalks } from './walker.mjs';
import { knowledgeRisks, linesFor } from './lines.mjs';

export function loadBuild(root) {
  const project = loadProject(root);
  const info = readJson(path.join(project.paths.build, 'build-info.json'));
  if (!info) throw new Error('No build found. Run: node .forge/forge.mjs build');
  const manifest = readJson(path.join(project.paths.build, 'script-manifest.json'));
  const twee = path.join(project.paths.build, 'dev', 'story.twee');
  const passages = parseTwee(readText(twee)).filter((p) => !p.tags.includes('debug'));
  return { project, info, manifest, passages, reportDir: path.join(project.paths.qa, 'reports', info.id) };
}

export function expectations(project) {
  const bm = project.branchMap || {};
  return {
    expectedEndings: bm.endings || [],
    expectedScenes: (bm.acts || []).flatMap((a) => (a.scenes || []).map((s) => s.id)),
  };
}

export function runStatic(root) {
  const b = loadBuild(root);
  const res = analyzeStatic({ passages: b.passages, start: b.info.start, moduleLinks: b.manifest?.moduleLinks || [], ...expectations(b.project) });
  writeJson(path.join(b.reportDir, 'static.json'), res);
  return { ...b, static: res };
}

export async function runFunctional(root, opts = {}) {
  const b = runStatic(root);
  // label 'optimized' re-runs the walks on build/optimized (the shipped game) after the optimizer.
  const { label = null, ...walkOpts } = opts;
  const html = path.join(b.project.paths.build, label || 'dev', 'index.html');
  if (!fs.existsSync(html)) throw new Error(`${path.relative(root, html)} not found`);
  const walk = await runWalks(root, { graph: b.static.graph, html, ...walkOpts });
  const sfx = label ? `-${label}` : '';
  writeJson(path.join(b.reportDir, `coverage${sfx}.json`), walk.coverage);
  writeJson(path.join(b.reportDir, `walk${sfx}.json`), walk);
  const md = functionalMarkdown(b, b.static, walk);
  writeText(path.join(b.reportDir, `functional${sfx}.md`), label ? md.replace(/^# Functional QA — build (\S+)/, `# Functional QA (${label}) — build $1`) : md);
  const all = [...b.static.findings, ...walk.findings];
  const summary = summarize(all);
  const sumFile = path.join(b.reportDir, 'summary.json');
  const prev = readJson(sumFile, {});
  writeJson(sumFile, { ...prev, buildId: b.info.id, at: new Date().toISOString(), [`functional${label ? `_${label}` : ''}`]: summary, ...(label ? {} : { coverage: walk.coverage.percent, endings: walk.endings }) });
  return { buildId: b.info.id, reportDir: b.reportDir, static: b.static, walk, summary, file: path.join(b.reportDir, `functional${sfx}.md`) };
}

export function summarize(findings) {
  const s = { S1: 0, S2: 0, S3: 0, S4: 0 };
  for (const f of findings) s[f.severity]++;
  return { ...s, pass: s.S1 === 0 && s.S2 === 0 };
}

function table(findings) {
  if (!findings.length) return '_None._\n';
  return ['| Sev | Kind | Passage | Detail |', '|---|---|---|---|', ...findings.map((f) => `| ${f.severity} | ${f.kind} | ${f.passage ?? '-'} | ${String(f.message).replace(/\|/g, '\\|')}${f.route ? `<br><sub>route: ${f.route.join(' → ')}</sub>` : ''} |`)].join('\n') + '\n';
}

function functionalMarkdown(b, st, walk) {
  const s = summarize([...st.findings, ...walk.findings]);
  return `# Functional QA — build ${b.info.id}

**Result:** ${s.pass ? 'PASS' : 'FAIL'} · S1 ${s.S1} · S2 ${s.S2} · S3 ${s.S3} · S4 ${s.S4}

| Metric | Value |
|---|---|
| Story passages | ${st.stats.storyPassages} (reachable statically: ${st.stats.reachable}) |
| Passage coverage (automated) | ${walk.coverage.passages}/${walk.coverage.total} (${walk.coverage.percent}%) |
| Links taken | ${walk.links.taken}/${walk.links.total} |
| Endings reached | ${walk.endings.reached.length}/${walk.endings.total} |
| Playthroughs | ${walk.walks} |
| Largest save | ${walk.maxSaveBytes ? `${walk.maxSaveBytes} bytes (base64)` : 'n/a'} |

## Static analysis
${table(st.findings)}
## Automated playthroughs
${table(walk.findings)}
${walk.coverage.unvisited.length ? `## Unvisited passages\n\n${walk.coverage.unvisited.map((n) => `- ${n}`).join('\n')}\n` : ''}
## Fix policy
S3/S4 may be auto-fixed (max ${b.project.config.limits?.qa_fix_retries ?? 3} attempts). S1/S2 go to the user with a proposed fix.
`;
}

/** Material for the character QA agent: lines per character + knowledge-timeline risks. */
export function characterQaInput(root, characterId = null) {
  const b = runStatic(root);
  const chars = b.project.characters.filter((c) => !characterId || c.id === characterId);
  return {
    buildId: b.info.id,
    reportDir: b.reportDir,
    rating: b.project.config.rating || null,
    characters: chars.map((c) => ({ id: c.id, sheet: path.relative(root, c.file).split(path.sep).join('/'), lines: linesFor(b.manifest, c.id).length })),
    lines: linesFor(b.manifest, characterId),
    knowledge: knowledgeRisks(b.manifest, b.static.graph, chars),
  };
}
