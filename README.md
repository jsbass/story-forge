# Twine Forge

A Claude Code plugin that turns a game idea into a playable, tested **Twine (SugarCube 2)** game. Role-specific agents do the work, and you approve each stage at a gate. The full design is in [docs/SPEC.md](docs/SPEC.md).

**Status: Phases 1–4 (the full spec).**
- **Phase 1, the narrative core:** a text-only game end to end. Interview, story bible, characters, game loops, script, build, then QA and playtest.
- **Phase 2, assets:**
  - a platform assessment of the GPU and ComfyUI
  - model installs through Stability Matrix, each needing your approval
  - generation with a local ComfyUI, and a review gallery
  - backgrounds, portraits, audio and video in the game

- **Phase 3, optimization and release:**
  - an optimizer: WebP images capped to display size, small variants for phones, video posters, image prefetching
  - performance QA in headless Chromium: desktop and a throttled phone profile, checked against budgets
  - packaging for an itch.io zip, a single HTML file, a static website, and an Electron desktop app

- **Phase 4, polish:**
  - shared style profiles for prose, art, UI and audio: two built-in examples, plus your own library in `~/.forge/styles`
  - three more loop modules: `inventory` (items and combine puzzles), `minigame` (dice skill checks and code locks), and `explore` (a hub map with a time budget)
  - an Engine Advisor that scores the design against SugarCube, Harlowe, ink, Ren'Py and Godot, behind an adapter boundary that leaves room for other engines (see [docs/engines.md](docs/engines.md))

Phase 2 needs ComfyUI running (by default at `http://127.0.0.1:8188`). These workflows have been tested live on an RTX 3070 (8 GB):

| Workflow | Time per run |
|---|---|
| SDXL images | ~15–21 s |
| SDXL drafts | ~2 s once loaded |
| Upscale | ~30 s |
| IP-Adapter portrait | ~26 s |
| ACE-Step 1.5 music, 30 s track | ~14 s |
| Wan 2.2 video, 2 s at 480p | ~87 s |
| Stable Audio 3 Medium sound effects and ambience, 12 s clip | ~10 s cold, ~3 s warm |

The Stable Audio Open fallback is still `untested`: its model is gated on Hugging Face and has to be downloaded manually. Voice-over has no workflow yet.

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
| `/forge:assess` | Shows what this machine can generate and the upgrade options |
| `/forge:assets [kind]` | Generates a batch of assets and opens the review gallery |
| `/forge:upgrade-assets` | Installs approved models mid-project, then unblocks or regenerates assets |
| `/forge:optimize` | Optimizes media and checks the performance budgets |
| `/forge:release` | Runs a final QA pass on the optimized build and packages every distribution target |
| `/forge:style [list\|show\|apply\|save]` | Manages shared style profiles |
| `/forge:engine` | Checks which engine fits the design and records the decision |

`/forge:new` installs the following **into the game project**. The plugin itself has no install step.
- `yaml` and `playwright` from npm
- Playwright's Chromium browser
- the SugarCube 2 story format, from the official `tmedwards/sugarcube-2` GitHub release

## Layout

| Path | Contents |
|---|---|
| `agents/` | Role subagents: story-planner, engine-advisor, character-designer, loop-designer, dialog-writer, asset-generator, game-builder, perf-optimizer, qa-functional, qa-character, qa-performance, game-packager |
| `skills/` | `forge-orchestrator` (runs the pipeline), `story-interview`, `art-direction`, `loop-design`, `forge-script` (the dialog format reference) |
| `commands/` | The `/forge:*` slash commands |
| `tools/forge.mjs` | The CLI the agents use, run as `node .forge/forge.mjs <cmd>` inside a project |
| `tools/script/` | The Forge Script parser and its deterministic compiler to Twee |
| `tools/build/` | The Twee → Twine 2 HTML compiler, the builder, and the playtest server |
| `tools/qa/` | Static analysis, Playwright playthroughs, the knowledge-timeline check, and performance QA |
| `tools/release/` | The optimizer and the packager (itch.io zip, single HTML, web, Electron) |
| `tools/lib/` | Pipeline state and gates, the dependency graph and impact analysis, the feedback log, git |
| `tools/assets/` | The ComfyUI client, workflow library, platform assessor, model installer (Stability Matrix and Civitai), asset manifest, generation queue, and review gallery |
| `workflows/` | Built-in ComfyUI workflows: SDXL images and drafts, upscaling, IP-Adapter portraits, Stable Audio, ACE-Step 1.5, Wan 2.2 |
| `assets-catalog.json` | Models the assessor may propose, with verified sources and checksums |
| `engine/` | The SugarCube runtime: widgets, settings, media playback, the debug overlay |
| `modules/` | Loop modules: `stats` (meters), `inventory` (items and recipes), `minigame` (skill checks and code locks), `explore` (hub map and time budget) |
| `styles/` | Built-in style profiles: `storm-gothic` and `cozy-storybook` |
| `engines.json`, `tools/engines/` | The engine catalog, the fit check, and the build adapters |
| `templates/` | Starter files for each stage (`forge template <name>`) |
| `examples/lantern-keeper/` | A tiny complete game used for end-to-end testing |

## Develop

```
npm test        # unit tests (no dependencies needed)
```

For an end-to-end check, run `node tools/forge.mjs new <tmp>/game --title Test`, copy in `examples/lantern-keeper/*`, then run `node .forge/forge.mjs build` and `node .forge/forge.mjs qa functional`. `node .forge/forge.mjs release` then runs the optimizer, QA on the optimized build, and packaging.

Building desktop executables (`package desktop --build --yes`) downloads Electron from npm. Publishing to itch.io (`publish itch --yes`) uses butler, which you install and log in to yourself.
