#!/usr/bin/env node
// Twine Forge CLI. Run from inside a game project: node .forge/forge.mjs <command>
import fs from 'node:fs';
import path from 'node:path';
import { requireProjectRoot, findProjectRoot, loadProject, PLUGIN_ROOT } from './lib/project.mjs';
import { assessCommand, modelsCommand, assetsCommand } from './assets/cli.mjs';
import { scaffoldProject, setupProject, initialCommit } from './lib/init.mjs';
import { STAGES, loadPipeline, savePipeline, computeStatus, nextStage, transition, artifactFiles } from './lib/state.mjs';
import { loadDeps, saveDeps, recordDeps, impactOf, staleArtifacts } from './lib/deps.mjs';
import { addFeedback, listFeedback, resolveFeedback, suggestRoute } from './lib/feedback.mjs';
import { commitAll, tag, tagExists, restorePaths, headShort, listTags } from './lib/git.mjs';
import { build, compileScripts, BuildError } from './build/builder.mjs';
import { servePlaytest } from './build/serve.mjs';
import { runStatic, runFunctional, characterQaInput, summarize } from './qa/report.mjs';
import { runPerformance } from './qa/perf.mjs';
import { optimize, formatOptimize } from './release/optimize.mjs';
import { packageGame, formatRelease, butlerPush, distributionSettings } from './release/package.mjs';

const HELP = `Twine Forge CLI

Project
  new <dir> --title "Title" [--no-setup] [--sugarcube <format.js>]   create a game project (installs deps unless --no-setup)
  setup [--sugarcube <format.js>] [--skip-browsers]                  install yaml, playwright, Chromium, SugarCube into the project
  status [--json]                                                     pipeline, stale artifacts, open feedback

Gates
  stage start|submit|approve|reject <stage> [--note "..."] [--no-commit]
  rollback <tag>                                                      restore a stage's artifacts from a tag (e.g. stage/script/v2)

Feedback & impact
  feedback add "text" [--stage s] [--target a,b] [--route agent] [--severity S2]
  feedback list [--open] [--json]
  feedback resolve <FB-id> [--note "..."]
  deps record <artifact> --from a,b,c
  impact <file|folder/>... [--json]
  stale [--json]

Build & QA
  compile [--json]                    parse + validate scripts only
  build [--dev-only]                  scripts -> src/*.twee -> build/{dev,release}/index.html
  playtest [--port 4173]              serve build/dev with the feedback endpoint
  qa static [--json]                  graph/variable analysis of the last build
  qa functional [--walks 60] [--max-steps 150] [--seed 1]   static + automated playthroughs
  qa functional --build optimized     re-run the playthroughs on build/optimized (the shipped game)
  qa performance [--target optimized,web,single-html]   load/transition/memory/save checks vs budgets
  qa character [--character id]       JSON input for the character-QA agent (lines + knowledge risks)

Release (Phase 3)
  optimize                            build/release -> build/optimized (WebP images, phone variants, posters)
  package [itch|single-html|web|desktop ...] [--force]   build/optimized -> dist/ (default: forge.yaml distribution)
  package desktop --build --yes       also download Electron (~100 MB) and build the executables (after approval)
  release [--walks 30] [--skip-performance]   build + optimize + QA on the shipped build + package
  publish itch [--project user/game] [--channel html5] --yes   butler push (only after the user approves)
  loops                               list loop modules and the variables they own
  template [name]                     list templates, or print one (e.g. character.yaml, forge-script)

Assets (Phase 2) - anything that downloads or installs needs --yes, given only after the user approves
  assess [--json] [--url http://127.0.0.1:8188]   scan GPU + ComfyUI, list capabilities and upgrade options
  models catalog | install <id> --yes | node-pack <id> --yes
  models search <query> [--type Checkpoint|LORA] [--base "SDXL 1.0,Illustrious"] | install-civitai <versionId> --yes
  assets sync                         add/refresh manifest entries from the scripts' @media cues
  assets list [--status s] [--kind k] | show <id>
  assets set <id> [--prompt ..] [--negative ..] [--workflow id@v] [--param k=v ...]
  assets generate [ids...] [--kind bg] [--count n] [--draft]
  assets gallery | review [--port 4174] | approve <id> [--candidate n] | reject <id> --note ".."
  assets workflows [--validate] | promote <workflow-id> | lora-dataset <character>
`;

function templateCmd(name) {
  const dir = path.join(PLUGIN_ROOT, 'templates');
  const extra = { 'forge-script': path.join(PLUGIN_ROOT, 'skills', 'forge-script', 'reference.md') };
  const names = [...fs.readdirSync(dir), ...Object.keys(extra)];
  if (!name) return console.log(names.join('\n'));
  const file = extra[name] || path.join(dir, name);
  if (!fs.existsSync(file)) throw new Error(`No template '${name}'. Available: ${names.join(', ')}`);
  process.stdout.write(fs.readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      let val = true;
      if (next !== undefined && !next.startsWith('--')) { val = next; i++; }
      // Repeated flags (e.g. --param a=1 --param b=2) collect into an array.
      flags[key] = key in flags ? [].concat(flags[key], val) : val;
    } else pos.push(a);
  }
  return { pos, flags };
}

const list = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const out = (data, json) => console.log(json ? JSON.stringify(data, null, 2) : data);

function printStatus(root) {
  const p = loadPipeline(root);
  const rows = computeStatus(root, p);
  const fb = listFeedback(root, { open: true });
  const stale = staleArtifacts(root, loadDeps(root));
  const next = nextStage(rows);
  return { rows, openFeedback: fb, staleArtifacts: stale, next: next ? next.id : null };
}

function formatStatus(s) {
  const icon = { pending: '·', in_progress: '…', awaiting_approval: '?', approved: '✓' };
  const lines = ['Stage                         Status              Ver  Notes'];
  for (const r of s.rows) {
    const notes = [];
    if (r.modified) notes.push(`modified since approval (${[...r.modified.changed, ...r.modified.added, ...r.modified.removed].length} files)`);
    if (r.stale) notes.push(`STALE: ${r.staleReasons.join('; ')}`);
    lines.push(`${icon[r.status]} ${r.label.padEnd(28)} ${r.status.padEnd(19)} v${String(r.version).padEnd(3)} ${notes.join(' | ')}`);
  }
  lines.push('');
  lines.push(`Next: ${s.next ?? 'nothing - all stages approved'}`);
  if (s.staleArtifacts.length) {
    lines.push('', 'Stale artifacts (upstream changed since they were produced):');
    for (const a of s.staleArtifacts) lines.push(`  ${a.artifact}  <- ${a.changed.join(', ')}`);
  }
  if (s.openFeedback.length) {
    lines.push('', 'Open feedback:');
    for (const f of s.openFeedback) lines.push(`  ${f.id} [${f.route}] ${f.summary}`);
  }
  return lines.join('\n');
}

function printFunctional(root, r) {
  console.log(`Functional QA${r.file.includes('functional-') ? ` (${path.basename(r.file, '.md').slice('functional-'.length)})` : ''} (build ${r.buildId}): ${r.summary.pass ? 'PASS' : 'FAIL'}  S1 ${r.summary.S1} · S2 ${r.summary.S2} · S3 ${r.summary.S3} · S4 ${r.summary.S4}`);
  console.log(`  coverage ${r.walk.coverage.percent}% · endings ${r.walk.endings.reached.length}/${r.walk.endings.total} · ${r.walk.walks} playthroughs`);
  console.log(`  report: ${path.relative(root, r.file)}`);
}

function printPerformance(root, r) {
  console.log(`Performance QA (build ${r.buildId}): ${r.summary.pass ? 'PASS' : 'FAIL'}  S1 ${r.summary.S1} · S2 ${r.summary.S2} · S3 ${r.summary.S3} · S4 ${r.summary.S4}`);
  for (const [name, t] of Object.entries(r.targets)) {
    const m = t.results.find((x) => x.profile === 'mobile');
    const d = t.results.find((x) => x.profile === 'desktop');
    console.log(`  ${name}: first passage ${m.first_passage_ms} ms phone / ${d.first_passage_ms} ms desktop · transition p95 ${m.transition_p95_ms} / ${d.transition_p95_ms} ms · ${Math.round(t.files.html_bytes / 1024)} KB html, ${(t.files.total_bytes / 1048576).toFixed(1)} MB total · heap +${d.heap_growth_mb} MB over ${d.transitions}`);
  }
  for (const f of r.findings) console.log(`  ${f.severity} ${f.kind.padEnd(12)} [${f.target}] ${f.message}`);
  console.log(`  report: ${path.relative(root, r.file)}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parseArgs(rest);
  if (!cmd || cmd === 'help' || flags.help) return console.log(HELP);
  if (cmd === 'template') return templateCmd(pos[0]);
  // These work with or without a project.
  if (cmd === 'assess') return assessCommand(findProjectRoot(), flags);
  if (cmd === 'models') return modelsCommand(findProjectRoot(), pos, flags);

  if (cmd === 'new') {
    if (!pos[0]) throw new Error('Usage: forge new <dir> --title "Title"');
    const title = typeof flags.title === 'string' ? flags.title : path.basename(path.resolve(pos[0]));
    const root = scaffoldProject(pos[0], { title });
    console.log(`Created ${root}`);
    if (!flags['no-setup']) await setupProject(root, { sugarcube: flags.sugarcube || null, skipBrowsers: !!flags['skip-browsers'] });
    console.log(`Initial commit ${initialCommit(root)}`);
    return;
  }

  const root = requireProjectRoot();

  switch (cmd) {
    case 'setup':
      await setupProject(root, { sugarcube: flags.sugarcube || null, skipBrowsers: !!flags['skip-browsers'] });
      return;

    case 'status': {
      const s = printStatus(root);
      return out(flags.json ? s : formatStatus(s), flags.json);
    }

    case 'stage': {
      const [action, id] = pos;
      if (!action || !id) throw new Error('Usage: forge stage start|submit|approve|reject <stage>');
      const p = loadPipeline(root);
      const st = transition(root, p, id, action, { note: flags.note });
      savePipeline(root, p);
      if (action === 'reject' && flags.note) {
        const stage = STAGES.find((s) => s.id === id);
        const fb = addFeedback(root, { text: flags.note, stage: id, targets: artifactFiles(root, stage), route: stage.owner.split(/[ ,(]/)[0] });
        console.log(`Logged ${fb.id} -> ${fb.route}`);
      }
      if (action === 'approve' && !flags['no-commit']) {
        const tagName = `stage/${id}/v${st.version}`;
        const sha = commitAll(root, `stage(${id}): approve v${st.version}${flags.note ? `\n\n${flags.note}` : ''}`);
        if (!tagExists(root, tagName)) tag(root, tagName, `Approved ${id} v${st.version}`);
        console.log(`Approved ${id} v${st.version} - commit ${sha}, tag ${tagName}`);
      } else console.log(`${id}: ${st.status} (v${st.version})`);
      return;
    }

    case 'rollback': {
      const ref = pos[0];
      if (!ref) throw new Error(`Usage: forge rollback <tag>. Tags: ${listTags(root, 'stage/*').join(', ') || 'none'}`);
      const m = /^stage\/([^/]+)\/v\d+$/.exec(ref);
      if (!m) throw new Error('Expected a stage tag like stage/script/v2');
      const stage = STAGES.find((s) => s.id === m[1]);
      restorePaths(root, ref, stage.artifacts.map((a) => a.replace(/\/$/, '')));
      const sha = commitAll(root, `rollback: restore ${stage.id} from ${ref}`);
      console.log(`Restored ${stage.artifacts.join(', ')} from ${ref} (commit ${sha}). Re-approve with: forge stage approve ${stage.id}`);
      return;
    }

    case 'feedback': {
      const sub = pos[0];
      if (sub === 'add') {
        const item = addFeedback(root, { text: pos.slice(1).join(' '), stage: flags.stage || null, targets: list(flags.target), route: flags.route || null, severity: flags.severity || null });
        const impacted = item.targets.length ? impactOf(root, loadDeps(root), item.targets) : [];
        return out(flags.json ? { ...item, impacted } : `${item.id} -> ${item.route}${impacted.length ? `\nDownstream of the targets: ${impacted.map((i) => i.artifact).join(', ')}` : ''}`, flags.json);
      }
      if (sub === 'list') {
        const items = listFeedback(root, { open: !!flags.open });
        return out(flags.json ? items : items.map((i) => `${i.id} ${i.status.padEnd(8)} [${i.route}] ${i.summary}`).join('\n') || 'No feedback.', flags.json);
      }
      if (sub === 'resolve') {
        const item = resolveFeedback(root, pos[1], { note: flags.note || '', commit: headShort(root) });
        return console.log(`${item.id} resolved`);
      }
      if (sub === 'route') return console.log(suggestRoute(pos.slice(1)));
      throw new Error('Usage: forge feedback add|list|resolve');
    }

    case 'deps': {
      if (pos[0] !== 'record' || !pos[1] || !flags.from) throw new Error('Usage: forge deps record <artifact> --from a,b');
      const d = loadDeps(root);
      const e = recordDeps(root, d, pos[1], list(flags.from));
      saveDeps(root, d);
      return console.log(`Recorded ${pos[1]} <- ${Object.keys(e.from).join(', ')}`);
    }

    case 'impact': {
      if (!pos.length) throw new Error('Usage: forge impact <file|folder/>...');
      const res = impactOf(root, loadDeps(root), pos);
      return out(flags.json ? res : res.length ? res.map((r) => `${'  '.repeat(r.depth - 1)}${r.artifact}${r.stale ? '  (stale)' : ''}  <- ${r.via}`).join('\n') : 'Nothing recorded downstream.', flags.json);
    }

    case 'stale': {
      const res = staleArtifacts(root, loadDeps(root));
      return out(flags.json ? res : res.map((r) => `${r.artifact} <- ${r.changed.join(', ')}`).join('\n') || 'Nothing stale.', flags.json);
    }

    case 'compile': {
      const { files, results, errors } = compileScripts(loadProject(root));
      const summary = { scripts: files.length, passages: results.reduce((n, r) => n + r.passages.length, 0), errors };
      if (flags.json) out(summary, true);
      else console.log(errors.length ? new BuildError(errors).message : `OK: ${summary.scripts} scripts, ${summary.passages} passages`);
      if (errors.length) process.exitCode = 1;
      return;
    }

    case 'build': {
      const info = await build(root, { modes: flags['dev-only'] ? ['dev'] : ['dev', 'release'] });
      if (flags.json) return out(info, true);
      console.log(`Build ${info.id}: ${info.storyPassages} story passages, ${info.endings.length} endings, start '${info.start}'`);
      for (const [mode, o] of Object.entries(info.outputs)) console.log(`  ${mode.padEnd(7)} ${o.html}  (${Math.round(o.bytes / 1024)} KB + ${o.mediaFiles} media files, ${Math.round(o.mediaBytes / 1024)} KB)`);
      if (info.media.referenced) console.log(`  media: ${info.media.available}/${info.media.referenced} cues have approved assets${info.media.missing.length ? ` - pending: ${info.media.missing.slice(0, 8).join(', ')}${info.media.missing.length > 8 ? ', …' : ''}` : ''}`);
      return;
    }

    case 'playtest':
      servePlaytest(root, { port: Number(flags.port) || 4173 });
      return;

    case 'qa': {
      const sub = pos[0] || 'functional';
      if (sub === 'static') {
        const r = runStatic(root);
        const s = summarize(r.static.findings);
        if (flags.json) out(r.static, true);
        else {
          console.log(`Static QA (build ${r.info.id}): ${s.pass ? 'PASS' : 'FAIL'}  S1 ${s.S1} · S2 ${s.S2} · S3 ${s.S3} · S4 ${s.S4}`);
          for (const f of r.static.findings) console.log(`  ${f.severity} ${f.kind.padEnd(20)} ${String(f.passage ?? '-').padEnd(24)} ${f.message}`);
        }
        if (!s.pass) process.exitCode = 1;
        return;
      }
      if (sub === 'functional') {
        const r = await runFunctional(root, {
          walks: Number(flags.walks) || 60,
          maxSteps: Number(flags['max-steps']) || 150,
          seed: Number(flags.seed) || 1,
          label: typeof flags.build === 'string' && flags.build !== 'dev' ? flags.build : null,
          log: flags.verbose ? console.log : () => {},
        });
        if (flags.json) out(r, true);
        else printFunctional(root, r);
        if (!r.summary.pass) process.exitCode = 1;
        return;
      }
      if (sub === 'performance') {
        const r = await runPerformance(root, { targets: list(flags.target), log: flags.verbose ? console.log : () => {} });
        if (flags.json) out(r, true);
        else printPerformance(root, r);
        if (!r.summary.pass) process.exitCode = 1;
        return;
      }
      if (sub === 'character') return out(characterQaInput(root, flags.character || null), true);
      throw new Error('Usage: forge qa static|functional|performance|character');
    }

    case 'optimize': {
      const r = await optimize(root, { log: () => {} });
      return out(flags.json ? r : formatOptimize(r), flags.json);
    }

    case 'package': {
      const targets = pos.length ? pos : null;
      if (flags.build && !flags.yes) throw new Error('`--build` downloads Electron (~100 MB) and @electron/packager from npm. Ask the user first, then re-run with --yes.');
      const r = packageGame(root, { targets, force: !!flags.force, buildDesktop: !!(flags.build && flags.yes) });
      out(flags.json ? r : formatRelease(r), flags.json);
      if (Object.keys(r.errors).length) process.exitCode = 1;
      return;
    }

    case 'release': {
      // Build -> optimize -> functional QA on the shipped build -> performance QA -> package.
      const info = await build(root, { modes: ['dev', 'release'] });
      console.log(`Build ${info.id}: ${info.storyPassages} story passages, ${info.endings.length} endings`);
      if (info.media.missing.length) console.log(`  note: ${info.media.missing.length} media cue(s) have no approved asset and are skipped in release`);
      console.log(formatOptimize(await optimize(root, { log: () => {} })));
      const fr = await runFunctional(root, { walks: Number(flags.walks) || 30, maxSteps: 150, seed: 1, label: 'optimized' });
      printFunctional(root, fr);
      let pass = fr.summary.pass;
      if (!flags['skip-performance']) {
        const pr = await runPerformance(root, { targets: ['optimized'] });
        printPerformance(root, pr);
        pass = pass && pr.summary.pass;
      }
      const r = packageGame(root, { force: !!flags.force });
      console.log(formatRelease(r));
      if (!pass) console.log('\nQA found S1/S2 issues - the packages were written, but fix the issues before shipping (see the reports above).');
      if (!pass || Object.keys(r.errors).length) process.exitCode = 1;
      return;
    }

    case 'publish': {
      if (pos[0] !== 'itch') throw new Error('Usage: forge publish itch [--project user/game] [--channel html5] --yes');
      const d = distributionSettings(loadProject(root).config).itch;
      const r = butlerPush(root, { project: flags.project || d.project, channel: flags.channel || d.channel, yes: !!flags.yes });
      console.log(r.ran ? `Pushed: ${r.command}` : `Would run: ${r.command}\nPublishing is public-facing: ask the user, then re-run with --yes. (butler must be installed and logged in by the user: butler login)`);
      return;
    }

    case 'assets':
      return assetsCommand(root, pos, flags);

    case 'loops': {
      const project = loadProject(root);
      const mods = project.loops.modules || [];
      if (!mods.length) return console.log('No loop modules in design/loops/loops.yaml');
      for (const m of mods) console.log(`${m.id} (${m.type}): ${JSON.stringify(m.params || {})}`);
      return;
    }

    default:
      throw new Error(`Unknown command '${cmd}'.\n\n${HELP}`);
  }
}

main().catch((e) => {
  console.error(e instanceof BuildError ? `Build failed - ${e.message}` : `forge: ${e.message}`);
  process.exitCode = 1;
});
