# Story Forge

A Claude Code plugin that turns a game idea into a playable, tested game. Role-specific agents do the work, and you approve each stage at a gate. The full design is in [docs/SPEC.md](docs/SPEC.md).

The plugin is deliberately light: generic agents, skills, commands, the `forge` CLI, and **preset packs** that a project copies in when it needs them. It contains no game content and installs nothing itself.

- **Generic roles.** The agents (`agents/`) and skills (`skills/`) describe each role's job without assuming an engine or asset tool.
- **Project playbooks.** Every project gets `forge/roles/<role>.md`, which the agents read first. Each playbook has sections copied from preset packs, plus the project's own notes.
- **Preset packs** (`presets/`) hold the tool-specific instructions and data. Today there are two:
  - `engines/sugarcube`: the SugarCube 2 runtime, the loop modules, build/QA/optimize/packaging settings and role sections. It downloads Playwright, Chromium and the SugarCube story format **into the project** when you choose the engine.
  - `assets/comfyui`: the tested ComfyUI workflow library, the model catalog and role sections. Models stay in the shared ComfyUI/Stability Matrix folder; each project records the files it uses in `forge/assets/models.lock.json`.

**Features (Phases 1–4 of the spec):**
- narrative core: interview, story bible, characters, game loops, script, build, QA and playtest
- assets through a local ComfyUI, with a platform assessment, approved-only model installs and a review gallery
- optimization, performance QA on desktop and phone profiles, and packaging (itch.io zip, single HTML, web, Electron)
- style profiles, four loop modules (`stats`, `inventory`, `minigame`, `explore`), and an Engine Advisor with an adapter boundary ([docs/engines.md](docs/engines.md))

The comfyui pack's workflows have been tested live on an RTX 3070 (8 GB):

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
claude plugin install <path-to>/story-forge/plugin     # or add the repo as a marketplace (it has .claude-plugin/marketplace.json)
```

The commands are namespaced `/forge:*`.

## Use

| Command | What it does |
|---|---|
| `/forge:new <folder> [title]` | Creates a game project and starts the concept interview |
| `/forge:status` | Shows where the pipeline is, what's stale, and open feedback |
| `/forge:next` | Runs the next stage up to its approval gate |
| `/forge:approve` / `/forge:reject` | Resolves a gate (approval commits the stage and tags it `stage/<name>/vN`) |
| `/forge:feedback <note>` | Logs a note, routes it to the right agent, and shows its downstream impact |
| `/forge:add-loop` | Adds a gameplay loop mid-project |
| `/forge:build` · `/forge:playtest` · `/forge:qa` | Builds the game, plays it with the dev tools, or runs QA |
| `/forge:rollback <stage>` | Restores a previously approved version of a stage |
| `/forge:assess` | Shows what this machine can generate and the upgrade options |
| `/forge:assets [kind]` | Generates a batch of assets and opens the review gallery |
| `/forge:upgrade-assets` | Installs approved models mid-project, then unblocks or regenerates assets |
| `/forge:optimize` | Optimizes media and checks the performance budgets |
| `/forge:release` | Runs a final QA pass on the optimized build and packages every distribution target |
| `/forge:style [list\|show\|apply\|save]` | Manages shared style profiles |
| `/forge:engine` | Checks which engine fits the design, then installs that engine's pack |

### What goes into a project, and when

| When | What | Where |
|---|---|---|
| `/forge:new` | `forge.yaml`, pipeline state, role playbook stubs, the `yaml` npm package, the asset pack's files (no downloads) | the project folder |
| `/forge:engine` (after the story bible, with your approval) | the engine pack: runtime + loop modules, `forge.yaml` build/QA/release settings, playbook sections, and its tools (for SugarCube: Playwright, Chromium ~150 MB, the story format) | `forge/engine/`, `node_modules/`, `vendor/` |
| Art direction / upgrades (each one approved) | image/audio/video models | the shared ComfyUI models folder, listed in `forge/assets/models.lock.json` |
| Release (approved) | Electron for desktop executables | the project |

`forge pack list | plan | install | remove` manages packs by hand. Re-installing keeps files you edited in the project unless you pass `--force`. Your project notes in the playbooks are never touched.

## Layout

| Path | Contents |
|---|---|
| `agents/` | Generic role subagents: story-planner, engine-advisor, character-designer, loop-designer, dialog-writer, asset-generator, game-builder, perf-optimizer, qa-functional, qa-character, qa-performance, game-packager |
| `skills/` | `forge-orchestrator` (runs the pipeline), `story-interview`, `art-direction`, `loop-design`, `forge-script` (the dialog format reference) |
| `commands/` | The `/forge:*` slash commands |
| `presets/engines/sugarcube/` | The SugarCube engine pack: `runtime/` (widgets, media playback, debug overlay), `modules/` (loop modules), `config.yaml`, `roles/`, `pack.json` |
| `presets/assets/comfyui/` | The ComfyUI asset pack: `workflows/`, `catalog.json` (models the assessor may propose, with verified sources and checksums), `config.yaml`, `roles/`, `pack.json` |
| `templates/` | Starter files for each stage, and the role playbook stub (`forge template <name>`) |
| `styles/` | Built-in style profiles: `storm-gothic` and `cozy-storybook` |
| `engines.json` | The engine catalog the Engine Advisor scores designs against |
| `tools/forge.mjs` | The CLI the agents use, run as `node .forge/forge.mjs <cmd>` inside a project |
| `tools/lib/` | Pipeline state and gates, the dependency graph and impact analysis, the feedback log, git, preset packs (`packs.mjs`), project setup |
| `tools/script/` | The Forge Script parser and its deterministic compiler |
| `tools/build/`, `tools/qa/`, `tools/release/` | The SugarCube build adapter, static/playthrough/performance QA, the optimizer and packager; they read the project's pack files and use the project's dependencies |
| `tools/assets/` | The ComfyUI client, workflow library, platform assessor and models lock, model installer, asset manifest, generation queue and review gallery |
| `tools/engines/` | The engine fit check and the build adapter registry |

## Develop

```
npm test        # unit tests (no dependencies needed)
```

The example project next to this folder (`../example/`, its own git repo) was created with this plugin and is used for end-to-end checks: from inside it, `node .forge/forge.mjs release`.

Building desktop executables (`package desktop --build --yes`) downloads Electron from npm. Publishing to itch.io (`publish itch --yes`) uses butler, which you install and log in to yourself.
