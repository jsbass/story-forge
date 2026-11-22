# Twine Forge

A Claude Code plugin that turns a game idea into a playable, tested **Twine (SugarCube 2)** game. Role-specific agents do the work, and you approve each stage at a gate. The full design is in [docs/SPEC.md](docs/SPEC.md).

**Status: Phase 1 (narrative core).** This phase produces a text-only game end to end: interview, story bible, characters, game loops, script, build, then QA and playtest. Assets (ComfyUI), optimization and packaging come in Phases 2–3.

## Install

```
claude plugin install <path-to>/twine-forge     # or add it via a local marketplace
```

The commands are namespaced `/forge:*`.

## Use

| Command | What it does |
|---|---|
| `/forge:new <folder> [title]` | Creates a game project, installs its dependencies, and starts the concept interview |
| `/forge:status` | Shows where the pipeline is, what's stale, and open feedback |
| `/forge:next` | Runs the next stage up to its approval gate |
| `/forge:approve` / `/forge:reject` | Resolves a gate (approval commits the stage and tags it `stage/<name>/vN`) |
| `/forge:feedback <note>` | Logs a note, routes it to the right agent, and shows its downstream impact |
| `/forge:add-loop` | Adds a gameplay loop mid-project |
| `/forge:build` · `/forge:playtest` · `/forge:qa` | Builds the game, plays it with the ⚙ debug overlay, or runs QA |
| `/forge:rollback <stage>` | Restores a previously approved version of a stage |

`/forge:new` installs the following **into the game project**. The plugin itself has no install step.
- `yaml` and `playwright` from npm
- Playwright's Chromium browser
- the SugarCube 2 story format, from the official `tmedwards/sugarcube-2` GitHub release

## Layout

| Path | Contents |
|---|---|
| `agents/` | Role subagents: story-planner, engine-advisor, character-designer, loop-designer, dialog-writer, game-builder, qa-functional, qa-character |
| `skills/` | `forge-orchestrator` (runs the pipeline), `story-interview`, `loop-design`, `forge-script` (the dialog format reference) |
| `commands/` | The `/forge:*` slash commands |
| `tools/forge.mjs` | The CLI the agents use, run as `node .forge/forge.mjs <cmd>` inside a project |
| `tools/script/` | The Forge Script parser and its deterministic compiler to Twee |
| `tools/build/` | The Twee → Twine 2 HTML compiler, the builder, and the playtest server |
| `tools/qa/` | Static analysis, Playwright playthroughs, and the knowledge-timeline check |
| `tools/lib/` | Pipeline state and gates, the dependency graph and impact analysis, the feedback log, git |
| `engine/` | The SugarCube runtime: widgets, settings, the debug overlay |
| `modules/stats/` | The first loop module: clamped meters, a sidebar and toasts |
| `templates/` | Starter files for each stage (`forge template <name>`) |
| `examples/lantern-keeper/` | A tiny complete game used for end-to-end testing |

## Develop

```
npm test        # unit tests (no dependencies needed)
```

For an end-to-end check, run `node tools/forge.mjs new <tmp>/game --title Test`, copy in `examples/lantern-keeper/*`, then run `node .forge/forge.mjs build` and `node .forge/forge.mjs qa functional`.
