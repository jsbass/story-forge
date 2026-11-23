#!/usr/bin/env node
// Story Forge CLI. Run from inside a game project: node .forge/forge.mjs <command>
import fs from 'node:fs';
import path from 'node:path';
import { requireProjectRoot, findProjectRoot, loadProject, PLUGIN_ROOT } from './lib/project.mjs';
import { assessCommand, modelsCommand, assetsCommand } from './assets/cli.mjs';
import { scaffoldProject, setupProject, initialCommit } from './lib/init.mjs';
import { STAGES, loadPipeline, savePipeline, computeStatus, nextStage, transition, artifactFiles } from './lib/state.mjs';
import { loadDeps, saveDeps, recordDeps, impactOf, staleArtifacts } from './lib/deps.mjs';
import { addFeedback, listFeedback, resolveFeedback, suggestRoute } from './lib/feedback.mjs';
import { commitAll, tag, tagExists, restorePaths, headShort, listTags } from './lib/git.mjs';
import { build, compileScripts, BuildError, loadModuleType, moduleTypes } from './build/builder.mjs';
import { listPacks, installPack, removePack, installedPacks, setupPlan } from './lib/packs.mjs';
import { servePlaytest } from './build/serve.mjs';
import { runStatic, runFunctional, characterQaInput, summarize } from './qa/report.mjs';
import { runPerformance } from './qa/perf.mjs';
import { engineFor, detectNeeds, fitReport, formatFit, setEngine, loadEngineCatalog, ADAPTERS } from './engines/index.mjs';
import { listStyles, getStyle, applyStyle, saveStyle, readPart, PROJECT_FILES, userStylesDir } from './lib/styles.mjs';
import { optimize, formatOptimize } from './release/optimize.mjs';
import { packageGame, formatRelease, butlerPush, distributionSettings } from './release/package.mjs';

const HELP = `Story Forge CLI

Project
  new <dir> --title "Title" [--no-setup] [--assets comfyui|none]   create a game project: forge.yaml, role playbooks
                                      (forge/roles/), the yaml npm package and the asset pack (files only)
  setup [--assets comfyui|none]       re-run that setup in an existing project
  status [--json]                     pipeline, stale artifacts, open feedback

Preset packs - tool-specific files + role playbook sections copied into the project (forge/)
  pack list [--json]                  packs the plugin offers, and which this project has installed
  pack plan <id>                      what installing it would download
  pack install <id> [--force] [--skip-setup] [--yes]   copy it in (edited files kept unless --force), run its setup
  pack remove <id>                    remove its files and playbook sections (your notes outside them stay)

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

Release (engine pack)
  optimize                            build/release -> build/optimized (WebP images, phone variants, posters)
  package [itch|single-html|web|desktop ...] [--force]   build/optimized -> dist/ (default: forge.yaml distribution)
  package desktop --build --yes       also download Electron (~100 MB) and build the executables (after approval)
  release [--walks 30] [--skip-performance]   build + optimize + QA on the shipped build + package
  publish itch [--project user/game] [--channel html5] --yes   butler push (only after the user approves)
  loops [types]                       the project's loop modules, or every module type the engine pack installed

Engine
  engine list                         engines the Engine Advisor knows, and which Story Forge can build
  engine check [--json]               what the design needs vs. each engine (blockers, risks, recommendation)
  engine set <name> [--rationale ..] [--risks a,b] --yes   record the decision and install the engine pack, which
                                      downloads its tools into the project (see: pack plan <name>) - after approval
  engine set <name> --skip-setup      record it and copy the pack without downloading anything

Style profiles - shared library in ~/.forge/styles (plus built-in examples)
  style list | show <name>
  style apply <name> [--parts prose,art,ui,audio]   combine profiles by applying different parts
  style save <name> [--parts ..] [--description ".."] [--force]   save this project's style to the library
  template [name]                     list templates, or print one (e.g. character.yaml, forge-script)

Assets (comfyui pack) - anything that downloads or installs needs --yes, given only after the user approves
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

function styleCommand(root, pos, flags) {
  const sub = pos[0] || 'list';
  if (sub === 'list') {
    const styles = listStyles(root);
    if (flags.json) return out(styles, true);
    if (!styles.length) return console.log(`No style profiles yet. Save one from a project: forge style save <name>  (library: ${userStylesDir()})`);
    for (const s of styles) console.log(`${s.name.padEnd(18)} ${s.builtin ? '[built-in] ' : ''}${s.description}\n${' '.repeat(19)}parts: ${s.parts.join(', ')}`);
    return;
  }
  if (sub === 'show') {
    const s = getStyle(pos[1], root);
    if (flags.json) return out({ ...s, content: Object.fromEntries(s.parts.map((p) => [p, readPart(s, p, root)])) }, true);
    console.log(`# ${s.name}${s.builtin ? ' (built-in)' : ''}\n${s.description}\n${s.dir}\n`);
    for (const p of s.parts) {
      const v = readPart(s, p, root);
      console.log(`## ${p}  ->  ${PROJECT_FILES[p]}\n${typeof v === 'string' ? v.trim() : JSON.stringify(v, null, 2)}\n`);
    }
    return;
  }
  if (!root) throw new Error('Run this inside a Forge project (no forge.yaml found)');
  if (sub === 'apply') {
    if (!pos[1]) throw new Error('Usage: forge style apply <name> [--parts prose,art,ui,audio]');
    const r = applyStyle(root, pos[1], { parts: list(flags.parts) });
    console.log(`Applied ${pos[1]}: ${r.applied.join(', ') || 'nothing'}${r.skipped.length ? ` (profile has no ${r.skipped.join(', ')})` : ''}\n  wrote ${r.files.join(', ')}`);
    return;
  }
  if (sub === 'save') {
    if (!pos[1]) throw new Error('Usage: forge style save <name> [--parts ...] [--description "..."] [--force]');
    const r = saveStyle(root, pos[1], { parts: list(flags.parts), description: typeof flags.description === 'string' ? flags.description : '', force: !!flags.force });
    console.log(`Saved ${pos[1]} (${r.saved.join(', ')}) to ${r.dir}${r.missing.length ? `\n  not in this project, so not saved: ${r.missing.join(', ')}` : ''}`);
    return;
  }
  throw new Error('Usage: forge style list | show <name> | apply <name> [--parts ..] | save <name> [--parts ..] [--description ..] [--force]');
}

const assetsFlag = (flags) => (flags.assets === 'none' || flags['no-assets'] ? null : typeof flags.assets === 'string' ? flags.assets : 'comfyui');
const formatPlan = (plan) => plan.map((s) => `  - ${s.step}${s.packages ? ` (${s.packages.join(', ')})` : ''}${s.approx_mb ? `, ~${s.approx_mb} MB` : ''}: ${s.why}`).join('\n');
const packSetupOptions = (flags) => ({ sugarcube: typeof flags.sugarcube === 'string' ? flags.sugarcube : null, skipBrowsers: !!flags['skip-browsers'] });

function printPack(r) {
  if (!r) return;
  console.log(`Pack ${r.id} (${r.kind}): copied ${r.copied.length} files${r.kept.length ? `, kept ${r.kept.length} you edited (--force overwrites them)` : ''}`);
  if (r.removed?.length) console.log(`  replaced engine pack: ${r.removed.join(', ')}`);
  if (r.config?.length) console.log(`  forge.yaml: added ${r.config.join(', ')}`);
  if (r.roles.length) console.log(`  playbooks: ${r.roles.map((f) => path.basename(f, '.md')).join(', ')}`);
  for (const s of r.setup || []) console.log(`  setup ${s.step}${s.skipped ? ' (skipped)' : ''}${s.version ? ` ${s.version}` : ''}`);
}

function printSetup(r) {
  console.log('Role playbooks: forge/roles/<role>.md (the agents read these; add project notes there)');
  if (r.assets) printPack(r.assets);
  else console.log('No asset pack installed (forge pack install comfyui adds one).');
  console.log('The engine is chosen after the story bible: forge engine check, then forge engine set <name>.');
}

async function packCommand(root, pos, flags) {
  const sub = pos[0] || 'list';
  if (sub === 'list') {
    const have = installedPacks(root);
    const packs = listPacks().map(({ dir, ...p }) => ({ ...p, installed: have[p.id] || null }));
    if (flags.json) return out(packs, true);
    for (const p of packs) console.log(`${p.id.padEnd(10)} [${p.kind}]${p.installed ? ` installed v${p.installed.version}` : ''}  ${p.label}\n${' '.repeat(11)}${p.description}`);
    return;
  }
  if (sub === 'plan') {
    if (!pos[1]) throw new Error('Usage: forge pack plan <id>');
    const plan = setupPlan(pos[1]);
    return console.log(plan.length ? `Installing ${pos[1]} downloads into this project:\n${formatPlan(plan)}` : `Installing ${pos[1]} copies files only; nothing is downloaded.`);
  }
  if (sub === 'install') {
    if (!pos[1]) throw new Error('Usage: forge pack install <id> [--force] [--skip-setup] [--yes]');
    const plan = setupPlan(pos[1]);
    if (plan.length && !flags['skip-setup'] && !flags.yes) throw new Error(`Pack ${pos[1]} downloads into this project:\n${formatPlan(plan)}\nAsk the user, then re-run with --yes (or --skip-setup).`);
    return printPack(await installPack(root, pos[1], { force: !!flags.force, skipSetup: !!flags['skip-setup'], setupOptions: packSetupOptions(flags) }));
  }
  if (sub === 'remove') {
    if (!pos[1]) throw new Error('Usage: forge pack remove <id>');
    return console.log(removePack(root, pos[1]) ? `Removed ${pos[1]}` : `${pos[1]} is not installed`);
  }
  throw new Error('Usage: forge pack list | plan <id> | install <id> [--force] [--skip-setup] [--yes] | remove <id>');
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
  if (cmd === 'style') return styleCommand(findProjectRoot(), pos, flags);

  if (cmd === 'new') {
    if (!pos[0]) throw new Error('Usage: forge new <dir> --title "Title"');
    const title = typeof flags.title === 'string' ? flags.title : path.basename(path.resolve(pos[0]));
    const root = scaffoldProject(pos[0], { title });
    console.log(`Created ${root}`);
    if (!flags['no-setup']) printSetup(await setupProject(root, { assets: assetsFlag(flags), skipNpm: !!flags['skip-npm'] }));
    console.log(`Initial commit ${initialCommit(root)}`);
    return;
  }

  const root = requireProjectRoot();

  switch (cmd) {
    case 'setup':
      printSetup(await setupProject(root, { assets: assetsFlag(flags), skipNpm: !!flags['skip-npm'] }));
      return;

    case 'pack':
      return packCommand(root, pos, flags);

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
      const info = await engineFor(loadProject(root).config).build(root, { modes: flags['dev-only'] ? ['dev'] : ['dev', 'release'] });
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
      const info = await engineFor(loadProject(root).config).build(root, { modes: ['dev', 'release'] });
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

    case 'engine': {
      const sub = pos[0] || 'check';
      if (sub === 'list') {
        const cat = loadEngineCatalog();
        for (const [id, e] of Object.entries(cat.engines)) console.log(`${id.padEnd(10)} ${e.label.padEnd(24)} [${ADAPTERS[id] ? 'buildable' : e.forge_support}]  ${e.summary}`);
        return;
      }
      if (sub === 'check') {
        const { needs, passages } = detectNeeds(root);
        const report = fitReport(needs);
        const current = loadProject(root).config.engine?.name || 'not chosen yet';
        if (flags.json) return out({ current, needs, passages, ...report }, true);
        console.log(`Current engine: ${current}\n`);
        console.log(formatFit(needs, passages, report));
        return;
      }
      if (sub === 'set') {
        if (!pos[1]) throw new Error('Usage: forge engine set <name> [--rationale ".."] [--risks a,b]');
        const adapter = engineFor({ engine: { name: pos[1] } });
        const skipSetup = !!flags['skip-setup'];
        const plan = setupPlan(adapter.pack);
        if (plan.length && !skipSetup && !flags.yes) {
          throw new Error(`Setting the engine installs the '${adapter.pack}' pack, which downloads into this project:\n${formatPlan(plan)}\nAsk the user, then re-run with --yes (or --skip-setup to record the choice without downloading).`);
        }
        const r = await setEngine(root, pos[1], {
          rationale: typeof flags.rationale === 'string' ? flags.rationale : '', risks: list(flags.risks), skipSetup, force: !!flags.force,
          setupOptions: { sugarcube: typeof flags.sugarcube === 'string' ? flags.sugarcube : null, skipBrowsers: !!flags['skip-browsers'] },
        });
        console.log(`forge.yaml engine: ${pos[1]}`);
        return printPack(r);
      }
      throw new Error('Usage: forge engine list | check [--json] | set <name> [--rationale ..] [--risks a,b]');
    }

    case 'loops': {
      if (pos[0] === 'types') {
        for (const type of moduleTypes(root)) {
          const { impl } = await loadModuleType(root, type);
          console.log(`${type.padEnd(10)} ${impl.description || ''}${impl.usage ? `\n${' '.repeat(11)}${impl.usage}` : ''}`);
        }
        console.log(`\nParameters and examples: the header of forge/engine/modules/<type>/module.mjs (forge template loops.yaml)`);
        return;
      }
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
