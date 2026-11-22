# Twine Game Forge — Specification (Draft v0.1)

A Claude Code plugin that turns a game idea into a playable, tested Twine (SugarCube 2) game. A team of role-specific agents does the work, and the user approves each stage.

> Working name: **Twine Forge**. Command prefix: `/forge:`.

---

## 1. Decisions so far

| Area | Decision |
|---|---|
| Build target | **Twine first.** v1 outputs SugarCube 2 through Tweego. The engine layer can be swapped later (Ink, Ren'Py, Godot, etc.). |
| Runtime | **Claude Code plugin**: one skill and one subagent per role, run by an orchestrator. |
| User involvement | **Approval gate after every stage.** |
| Story planning | **Interactive interview** before any documents are written. |
| Character bios | **Structured sheet** (YAML) plus a prose summary. Dialog QA uses the sheet as its source of truth. |
| Dialog authoring | **Script format first**, then converted to Twee by a deterministic compiler. |
| Game loops | Chosen during the design interview. **New loop modules can be added mid-project.** |
| Story format | **SugarCube 2** |
| Asset generation | **Local ComfyUI** for images, SFX/ambience, music and video. Agents may create and modify workflows and save them to a versioned library. |
| Functional QA | **Static analysis plus automated Playwright playthroughs.** |
| Performance focus | Load time and asset size, runtime smoothness, mobile/low-end devices, save-state size. |
| Feedback | **Chat, logged to a feedback file**, routed to the right agent, and only affected work is rerun. |
| Upstream changes | **Impact analysis, then ask** before regenerating anything. |
| QA fixes | **Auto-fix minor issues** (retry cap), **escalate major ones** to the user. |
| Versioning | **One git repo per game.** Each approved stage gets a tag. |
| Playtesting | **Local browser preview with a debug overlay.** |
| Game size | **Set per project** during the interview. |
| Platform capability | A **Platform Assessor** skill scans the GPU and ComfyUI models and node packs and produces a capability profile. It can be rerun at any time. **Asset generation can be upgraded mid-project.** |
| Model installs | The assessor **proposes local model downloads** (name, source, size, VRAM fit) and installs **only what you approve**. |
| Voice-over | **Optional per project.** Text-only by default. When enabled, uses local TTS and a voice profile on each character sheet. |
| Content rating | **Set in the interview** (rating + themes to avoid) and **enforced by QA** for both text and assets. |
| Distribution | **All four targets:** itch.io web zip, single self-contained HTML, static website, desktop wrapper. |
| Style profiles | **Optional reusable house style profiles** (prose, art, UI, audio) shared across games. |
| Reviewers | **Single user (you) approves all gates in v1.** |
| Art style | **No global default.** Each project's interview picks an art style, the assessor suggests suitable models, and approved models are downloaded **through Stability Matrix**. |
| Model install location | **Stability Matrix shared `Models\` folder**, so every package Stability Matrix manages can use them. |
| Character LoRAs | **Optional, main cast only.** Offered after the reference portraits are approved. Minor characters use IP-Adapter only. |
| Build order | **Narrative core first:** a playable text-only game end to end, then assets, then optimization and packaging. See §9. |
| Limits (defaults) | Forge Script format kept. **3 auto-fix retries**, **4 generations per asset** before asking. Token budgets per stage are reported but not enforced. All adjustable in `forge.yaml`. |

---

## 2. Pipeline overview

```
 ┌──────────────┐   ┌─────────────┐   ┌────────────┐   ┌─────────────┐
 │ 1 Interview  │──▶│ 2 Story     │──▶│ 3 Character│──▶│ 4 Game Loop │
 │  (Planner)   │   │   Bible     │   │    Bios    │   │   Design    │
 └──────────────┘   └─────────────┘   └────────────┘   └─────────────┘
        ▲ GATE            GATE              GATE              GATE
                                              │                 │
                       ┌──────────────────────┴───────┐         ▼
                       ▼                              │   ┌─────────────┐
                ┌─────────────┐                       └──▶│ 5 Script /  │
                │ 6 Assets    │◀── asset requests ────────│   Dialog    │
                │ (ComfyUI)   │                           └─────────────┘
                └─────────────┘                                GATE
                    GATE (per batch)                             │
                       │                                         ▼
                       │          ┌─────────────┐   ┌─────────────────┐
                       └─────────▶│ 7 Build     │──▶│ 8 Optimize      │
                                  │ (SugarCube) │   │                 │
                                  └─────────────┘   └─────────────────┘
                                                             │
                     ┌────────────────┬──────────────────────┤
                     ▼                ▼                      ▼
              ┌────────────┐   ┌────────────┐        ┌────────────┐
              │ 9a QA:     │   │ 9b QA:     │        │ 9c QA:     │
              │ Character  │   │ Function   │        │ Performance│
              └────────────┘   └────────────┘        └────────────┘
                     └────────────────┴──────┬───────────────┘
                                             ▼
                                  Fix loop ──▶ PLAYTEST GATE ──▶ 10 Release
```

- Stages 1 to 5 run in order. Each one needs the previous stage approved.
- **Asset generation (6) can start early.** Portraits and key backgrounds can begin once Bios (3) are approved, running alongside Loop Design and Script. Scene-specific assets wait for the Script.
- The three QA agents (9a/9b/9c) run in parallel against the same build.

---

## 3. Project layout (one git repo per game)

```
my-game/
├── forge.yaml                 # project config: title, size, format, gates, budgets, comfy endpoint
├── state/
│   ├── pipeline.json          # stage status: pending | in_progress | awaiting_approval | approved | stale
│   ├── deps.json              # dependency graph between artifacts (used for impact analysis)
│   └── feedback/
│       ├── FB-0001.md         # one file per piece of user feedback, with routing + resolution
│       └── index.yaml
├── design/
│   ├── interview.md           # Q&A transcript from stage 1
│   ├── story-bible.md         # premise, themes, tone, world, structure
│   ├── branch-map.yaml        # acts → scenes → branches → endings (machine-readable)
│   └── loops/
│       ├── loops.yaml         # active loop modules + parameters
│       └── <loop-id>.md       # design doc per loop
├── characters/
│   ├── <char-id>.yaml         # structured sheet (QA source of truth)
│   └── <char-id>.md           # prose bio
├── script/
│   └── <scene-id>.script.md   # authored dialog in Forge Script format
├── assets/
│   ├── manifest.yaml          # every asset: id, type, prompt, workflow, seed, status, deps
│   ├── workflows/             # project-specific ComfyUI workflow JSON (versioned)
│   ├── refs/                  # character reference images / LoRAs for consistency
│   ├── raw/                   # generator output (git-lfs or ignored)
│   └── final/                 # optimized, shipped assets
├── src/                       # generated Twee 3 + JS/CSS
│   ├── story/*.twee
│   ├── modules/<loop-id>/     # widgets.twee, module.js, module.css
│   └── engine/                # StoryInit, save config, debug overlay (dev only)
├── build/
│   ├── dev/index.html         # with debug overlay
│   └── release/index.html
└── qa/
    ├── reports/<build-id>/    # character.md, functional.md, performance.md, coverage.json
    └── playthroughs/          # recorded routes, screenshots
```

A **shared workflow library** sits outside individual games (e.g. `~/.forge/comfy-library/`). Workflows that work well in one project are promoted there after the user approves.

---

## 4. Roles (skills + subagents)

Every role is defined by: **purpose · inputs · outputs · tools · completion criteria · who handles feedback**.

### 4.0 Orchestrator (`forge-orchestrator`)
- **Purpose:** Runs the pipeline. Keeps `pipeline.json` and `deps.json` up to date, starts subagents, presents the approval gates, routes feedback, runs impact analysis, and commits/tags in git.
- **Does not** write creative content itself.
- **At each gate it shows:** a summary of what changed, links to the artifacts, the QA status, and the options *Approve / Request changes / Roll back*.
- **On approval:** commits and tags the stage as `stage/<name>/v<N>`.

### 4.1 Story Planner (`story-planner`)
- **Purpose:** Interviews the user, then writes the Story Bible and branch map.
- **Interview topics (adaptive, asked a few at a time):** genre, tone, audience, **content rating + themes to avoid**, **style profile**, **art style** (see Art Direction step below), **voice-over on/off**, **distribution targets**, themes, setting, protagonist perspective, **target length/size**, how many endings, how much branching (linear-with-flavor vs. heavily branching), inspirations, **preferred game loops** (handed to 4.4), art direction, and audio mood.
- **Outputs:** `interview.md`, `story-bible.md`, `branch-map.yaml` (scene IDs, links between scenes, the conditions that gate each branch, and endings).
- **Done when:** every scene in the branch map has a purpose, every ending can be reached on paper, and the size matches the chosen target.
- **Art Direction step (part of the interview, run jointly with the Platform Assessor):**
  1. The planner shows 3–4 art style directions that fit the story (e.g. painterly fantasy, anime visual novel, noir photoreal, pixel art). Each comes with a short description and, where an installed model can make one, a quick SDXL-Turbo sample.
  2. Once you pick a style, the assessor suggests **models that suit it and fit in 8 GB of VRAM**: a base checkpoint, style LoRAs, a matching IP-Adapter, and an upscaler. For each it gives the source (Civitai or Hugging Face), size, license and VRAM fit, and notes models you already have that would work.
  3. Approved models are **downloaded through Stability Matrix** into its shared `Models\` folder (see 4.10 → *Model installation*).
  4. The choice is saved as the project's `art` style (and can be saved as a reusable style profile).

### 4.2 Engine Advisor (`engine-advisor`) — small in v1
- **Purpose:** Records the engine and format choice with a rationale. In v1 it always picks SugarCube 2, but it flags designs that would need features Twine can't handle well (real-time action, physics) so the user knows early.
- **Output:** a section in `forge.yaml`. This keeps a place ready for supporting other engines later.

### 4.3 Character Designer (`character-designer`)
- **Purpose:** Writes the cast.
- **Structured sheet (`<char-id>.yaml`):**
  ```yaml
  id: mara
  name: Mara Vell
  role: deuteragonist
  age: 34
  voice:
    register: terse, dry humor
    vocabulary: [nautical slang, avoids profanity]
    speech_tics: ["Right then.", rhetorical questions when nervous]
    never_says: [modern slang, "honestly"]
  personality: { values: [loyalty, competence], fears: [deep water], flaws: [stubborn] }
  knowledge:                     # what she knows, and from when
    - fact: "Captain is alive"
      learned_at: scene_07       # QA uses this to catch characters knowing things too early
  relationships: { player: {initial: wary, affinity_var: $mara_aff}, captain: loyal }
  arc: { start: "trusts no one", turn: scene_12, end: "chooses crew over ship" }
  visual: { description: "...", palette: [...], ref_images: [refs/mara_*.png] }
  ```
- **Outputs:** sheets, prose bios, and visual reference prompts for the Asset agent.
- **Done when:** every character named in the branch map has a sheet, and every story variable linked to a relationship is listed.

### 4.4 Game Loop Designer (`loop-designer`)
- **Purpose:** Designs gameplay loops that fit the themes. Loops are built as **modules** that can be added, adjusted or removed at any point.
- **Module types offered (the list can grow):** stats/relationships, inventory and puzzles, embedded minigames, exploration/time budget, plus anything the user suggests.
- **Each loop doc covers:** the fantasy it serves and how it ties to the theme, the core loop (action → feedback → reward), the variables it owns, how it affects branches, balance numbers, failure states, and UI needs.
- **`loops.yaml`** sets the module contract: its variables, the widgets it exposes, and the scenes it hooks into.
- **Adding a loop mid-project:** `/forge:add-loop` runs a short design conversation, then impact analysis, and lists which scenes, scripts and builds would change before anything is touched.

### 4.5 Dialog Writer (`dialog-writer`)
- **Purpose:** Writes the scenes in the **Forge Script** format, working from the branch map, character sheets and loop hooks.
- **Forge Script format (draft):**
  ```markdown
  # SCENE scene_07 — The Flooded Hold
  @bg hold_flooded   @music tension_low   @ambience drip_loop

  MARA: Right then. Water's at the second rung.
  MARA (quiet): You didn't see the Captain's log. Did you?

  * [Tell her the truth] -> scene_08a  {set $mara_aff += 2}
  * [Lie] -> scene_08b                  {set $lied_to_mara = true}
  * [Use the rope] -> scene_08c         {requires item:rope}    # loop hook
  ```
- **Process:** a structure pass first, then a **voice pass for each character** against their sheet.
- **Asset requests:** every `@bg`, `@sfx`, `@music` and `@portrait` tag that isn't in `assets/manifest.yaml` yet is added as a request automatically.
- **Done when:** every scene in the branch map has a script, all choices point to valid targets, and every loop hook names a variable that actually exists.

### 4.6 Asset Generator (`asset-generator`) — ComfyUI
- **Purpose:** Turns asset requests into finished media using the local ComfyUI instance.
- **Integration:** ComfyUI HTTP/WebSocket API (default `http://127.0.0.1:8188`), wrapped in a small **MCP server or Python CLI** with commands like `list_models`, `queue_workflow`, `get_result`, `upload_ref` and `validate_workflow`.
- **Media types:**
  | Type | Typical workflow | Output format |
  |---|---|---|
  | Portraits / expressions | Text-to-image + IP-Adapter/LoRA for consistency | WebP/PNG |
  | Backgrounds / UI | Text-to-image, upscale | WebP |
  | SFX / ambience | Audio model (e.g. Stable Audio Open) | OGG/Opus + MP3 fallback |
  | Music loops | Audio model, loop-point trim | OGG/Opus |
  | Video / animated scenes | Video model (e.g. Wan/LTX) | WebM (VP9/AV1) + MP4 fallback |
- **Workflow library:** the agent may build or modify workflow JSON. Each workflow it saves records the models it needs, its parameters, a sample output, and a version. The user can promote a project workflow to the shared library.
- **Manifest entry:** `id, type, request_source (scene/char), prompt, negative, workflow@version, seed, params, status (requested|generated|approved|final), files`. This makes every asset reproducible.
- **Consistency:** character assets always use the reference images or LoRA from `characters/<id>.yaml → visual`.
- **Character LoRA training (optional, main cast only):**
  - Offered once a main character's reference portrait set (~15–30 images in different poses and expressions, made with IP-Adapter) is approved.
  - Trained locally on the 8 GB GPU with an SDXL LoRA trainer (e.g. kohya_ss / OneTrainer, installable as a Stability Matrix package). Low-memory settings, ~30–60 minutes per character, run in the background queue.
  - The finished LoRA is saved to `Models\Lora\forge\<project>\<char-id>.safetensors` and linked in the character sheet. A test grid is shown for approval before it is used.
  - Minor characters use IP-Adapter only.
- **Gate:** assets are approved in **batches** shown as contact sheets or galleries. Rejected assets go back with feedback, and the seed and parameters are tweaked.
- **Capability-aware:** before planning a batch, it reads `state/capabilities.yaml` (from 4.10). Asset types the current setup can't produce get a **spec + placeholder** entry (status `blocked_capability`) and are listed as upgrade candidates. They don't fail the build.
- **Queueing:** one GPU job at a time (8 GB card). Long jobs (video, music) run in a background queue, with progress and estimated time shown in `/forge:status`. Images take priority so the build is never blocked.
- **Voice-over (when enabled):** each character sheet gets `voice: { tts_model, voice_ref, pitch, pace }`. Lines are generated per scene and named `vo/<scene>/<line#>.ogg`. The Builder wires them to the dialog lines.
- **Content rating:** every generation prompt gets the project's negative/avoid terms added. Generated images are checked against the rating before they reach the approval gallery.

### 4.7 Builder (`game-builder`)
- **Purpose:** Produces the playable SugarCube game.
- **Steps:**
  1. **Script compiler (deterministic code, not the LLM):** `.script.md` → Twee 3 passages. The LLM only handles the parts the compiler can't (custom macros, special layouts).
  2. Writes `StoryInit` from the variables owned by each loop and character.
  3. Generates each loop module as SugarCube widgets + JS + CSS.
  4. Wires up media: preloads, an audio track/group setup, and portrait/background layers.
  5. Sets up save/load, settings (volume, text speed) and accessibility (font size, reduced motion).
  6. Compiles with **Tweego** to `build/dev` (with debug overlay) and `build/release`.
  7. Makes sure the output can also be **opened in the Twine 2 editor** (Twee import).
- **Debug overlay (dev build only):** jump to any passage, view and edit variables, show branch coverage, and a feedback button that writes to `state/feedback/` and records the current passage and state.

### 4.8 Performance Optimizer (`perf-optimizer`)
- **Purpose:** Makes the build fit the budgets in `forge.yaml`.
- **Areas:** image resizing and WebP/AVIF conversion with responsive variants, audio bitrate and Opus encoding, video transcoding and poster frames, lazy-loading assets per chapter, choosing between inlined and external assets, minifying CSS/JS, trimming history (`Config.history.maxStates`), keeping story variables lean (e.g. using `_temp` variables, clearing finished-module state), and limiting DOM/animation work.
- **Example default budgets (adjustable per project):** first passage interactive in under 2 s on a mid-range mobile device over 4G, HTML under 2 MB with assets loaded separately, passage transitions under 100 ms, saves under 100 KB.

### 4.8b Packager (`game-packager`)
- **Purpose:** Turns the optimized release build into the distribution targets set in `forge.yaml → distribution`.
- **Targets:**
  | Target | Output | Notes |
  |---|---|---|
  | itch.io web zip | `dist/itch/<game>.zip` (index.html + assets/) | Checks itch.io's file count and size limits; optional `butler push` |
  | Single HTML | `dist/single/<game>.html` | Assets inlined as base64. **Warns or blocks** when over the size budget (e.g. video present) |
  | Static website | `dist/web/` | Cache-busting hashed filenames, relative paths, CDN-friendly |
  | Desktop wrapper | `dist/desktop/{win,mac}` | Electron (default) or NW.js. Saves go to the user data folder. Optional Steam-ready layout |
- Performance QA runs against each target that's produced.

### 4.9 QA agents

#### 9a. Character & Dialog Consistency QA (`qa-character`)
- Checks every line against the speaker's sheet: voice/register, `never_says`, speech tics, and how their personality fits the moment.
- **Knowledge-timeline check:** flags any character who mentions a fact before the `learned_at` scene on the current route.
- **Arc check:** the character's attitude moves the way the arc describes, and nothing contradicts the relationship variables.
- Checks for continuity errors across branches (e.g. a character refers to an event the player may have skipped).
- **Content rating check:** flags text that goes beyond the project rating or touches an avoided theme (S2 by default).
- **Output:** findings with scene, line, the rule broken, severity, and a suggested rewrite.

#### 9b. Functionality QA (`qa-functional`)
- **Static:** Tweego parse, broken links, unreachable passages, dead ends that aren't endings, variables used but never set (or set but never used), macro errors, missing assets referenced in the manifest, and invariants for each loop (e.g. affinity stays between 0 and 10).
- **Dynamic (Playwright):** directed walks to **every ending**, random/fuzz walks, a save/load round-trip at random points, console error capture, coverage report (passages and choices visited), and screenshots on failure.
- **Output:** `functional.md` + `coverage.json`.

#### 9c. Performance QA (`qa-performance`)
- Runs Lighthouse/Playwright traces in desktop and mobile emulation (CPU slowed and network limited).
- Measures load time, transition latency, memory over a long session (e.g. 500 passage transitions), save size, and total asset weight.
- Reports each result against the `forge.yaml` budgets as pass or fail.

### 4.10 Platform Assessor (`platform-assessor`) — can run on its own
- **Purpose:** Works out what this machine can generate, and proposes upgrades.
- **When it runs:** `/forge:assess` at any time, automatically at `/forge:new`, and before each asset batch if the last scan is more than 7 days old.
- **What it scans:**
  1. Hardware: GPU model, VRAM total/free, system RAM, CPU, free disk (`nvidia-smi`, OS queries).
  2. ComfyUI: reachability, version, launch arguments (`/system_stats`), installed models per folder (`/models/<folder>`), available nodes and custom node packs (`/object_info`).
  3. Partial or broken downloads (e.g. Stability Matrix `*.smdownload` files), and models missing a companion file (e.g. a VAE with no diffusion model or text encoder).
- **Output:** `state/capabilities.yaml` (per project, plus a machine-wide copy at `~/.forge/capabilities.yaml`):
  ```yaml
  scanned_at: 2026-11-22
  hardware: { gpu: RTX 3070, vram_gb: 8, ram_gb: 32, disk_free_gb: 2778 }
  comfyui: { url: http://127.0.0.1:8188, version: 0.46.0, host: StabilityMatrix }
  capabilities:
    image:      { status: ready,   models: [epicrealismXL, novaFurryXL, sdxl_turbo] }
    char_consistency: { status: missing, needs: [ipadapter_sdxl, clip_vision_h] }
    sfx:        { status: missing, candidates: [stable_audio_open_1.0] }
    music:      { status: missing, candidates: [ace_step_1.5] }
    tts:        { status: missing, candidates: [local TTS custom node] }
    video:      { status: missing, candidates: [wan2.2_ti2v_5b, ltxv_2b_distilled], note: "8GB: short low-res clips only" }
    upscale:    { status: missing, candidates: [4x-UltraSharp / RealESRGAN] }
  ```
- **Upgrade proposals:** for each missing or limited capability it lists the candidate models with source, download size, expected VRAM, rough generation time on this GPU, and which node pack is needed. **Nothing is downloaded or installed without your explicit approval for each item.**
- **Model installation (through Stability Matrix):**
  - Location: the Stability Matrix shared folder `%APPDATA%\StabilityMatrix\Models\<Type>\` (e.g. `StableDiffusion`, `Lora`, `IpAdaptersXl`, `ClipVision`, `ESRGAN`, `DiffusionModels`, `TextEncoders`). ComfyUI already loads models from here.
  - **Preferred method:** after you approve, the agent downloads the file directly into the right Stability Matrix folder and writes the same metadata sidecar Stability Matrix creates for its own downloads (`<model>.cm-info.json` + preview image), so the model appears in Stability Matrix's model browser just as if it were downloaded there. It then calls ComfyUI's model refresh and checks the file hash.
  - **Fallback:** if direct download isn't possible (e.g. a Civitai model needs login, or the metadata format changes), the agent gives you the exact model name or link to download in Stability Matrix's Model Browser, then rescans once you confirm it's done.
  - Custom node packs (e.g. a local TTS node) are installed through ComfyUI-Manager, or Stability Matrix's extension manager, after you approve.
  - Every install is recorded in `~/.forge/installs.log` (source, hash, size, license, the project that requested it).
- **Upgrading mid-project (`/forge:upgrade-assets`):**
  1. Rerun the assessment, then show the new capabilities next to the old ones.
  2. List the assets this unblocks (`blocked_capability` → `requested`) and assets that could be **regenerated at higher quality** (e.g. images made before IP-Adapter was available, for better character consistency).
  3. You choose: generate the unblocked assets only / also regenerate selected assets / defer.
  4. Workflows made with the new models are added to the library. Existing approved assets stay as they are unless you choose to regenerate them.
  5. The change is committed and tagged as `assets/upgrade-<N>`.

### 4.11 Style Profiles (shared library)
- Kept at `~/.forge/styles/<profile>/`: `prose.md` (voice, tense, sentence rhythm, examples), `art.yaml` (model, LoRA, workflow, prompt prefix/suffix, palette, reference images), `ui.css` (SugarCube theme), `audio.yaml` (mood, instruments, tempo range).
- The interview offers the existing profiles. A project can use one, combine several, or override individual parts. A project's style can be saved back as a new profile.

---

## 5. Development and feedback cycle

### 5.1 Gates
Every stage ends in `awaiting_approval`. The orchestrator presents:
1. **What was produced** (links to files, a short summary, and a diff if this is a revision).
2. **Automated checks** that apply to that stage (e.g. reachability on paper for the branch map, the QA summary for builds).
3. **Choices:** ✅ Approve · ✏️ Request changes · ⏪ Roll back to a previous tag.

### 5.2 Feedback flow
```
User note in chat (or debug-overlay button)
   → Orchestrator writes state/feedback/FB-####.md
        { text, stage, target artifacts, passage/state snapshot if from playtest }
   → Classify & route  (bio → character-designer, line → dialog-writer,
                         bug → game-builder, balance → loop-designer, art → asset-generator)
   → Impact analysis via deps.json → list what else would change
   → Ask user to confirm scope (if anything beyond the target artifact is affected)
   → Agent revises → affected checks re-run → show diff at gate
   → FB file marked resolved with commit hash
```

### 5.3 Dependency tracking and impact analysis
- Every artifact records what it was built from in `deps.json` (e.g. `script/scene_07` ← `characters/mara@v3`, `design/loops/inventory@v1`, `branch-map@v2`).
- When an upstream artifact changes, everything downstream is marked **stale**. The orchestrator shows a list like *"bio change to Mara affects 14 scenes, 6 portraits, 1 build"* and asks: regenerate all / pick specific items / leave them marked stale.

### 5.4 QA fix loop
| Severity | Examples | Handling |
|---|---|---|
| **S4 Cosmetic** | typo, CSS glitch | Fixed automatically |
| **S3 Minor** | small voice slip, missing preload, unused variable | Fixed automatically, **max 3 attempts**, then escalated |
| **S2 Major** | broken branch, budget missed, knowledge-timeline error | Sent to the user with a proposed fix |
| **S1 Story/Character** | a fix would change plot, a character, or a loop's design | Always sent to the user, never fixed automatically |

Every automatic fix is committed separately (`qa-fix: ...`) so it can be reviewed or reverted.

### 5.5 Versioning
- One git repo per game, with a commit for each agent action.
- Stage approval → tag `stage/<name>/v<N>`. Playtest builds → tag `build/<N>`.
- Raw generated media goes in Git LFS (or is git-ignored and regenerated from the manifest seed and workflow).

---

## 6. Commands (draft)

| Command | Action |
|---|---|
| `/forge:new <name>` | Set up the repo and start the Planner interview |
| `/forge:status` | Pipeline state, stale artifacts, asset queue, open feedback |
| `/forge:next` | Run the next stage that's ready |
| `/forge:approve` / `/forge:reject` | Resolve the current gate |
| `/forge:feedback <note>` | Log and route feedback |
| `/forge:add-loop` | Design and add a new loop module mid-project |
| `/forge:assets [batch]` | Generate or review assets |
| `/forge:build` · `/forge:playtest` | Compile and open the dev build in the preview |
| `/forge:qa [character\|functional\|performance\|all]` | Run QA |
| `/forge:rollback <tag>` | Restore an approved stage |
| `/forge:release` | Optimize, run the final QA pass, package every distribution target in `forge.yaml` |
| `/forge:assess` | Run the Platform Assessor and update the capability profile |
| `/forge:upgrade-assets` | Propose and install approved models, then unblock or regenerate assets |
| `/forge:style [list\|save\|apply]` | Manage shared style profiles |

---

## 7. Platform assessment — results from 2026-11-22

| Item | Finding |
|---|---|
| GPU | NVIDIA RTX 3070, **8 GB VRAM**, compute 8.6, driver 610.88 |
| System | Ryzen 7 3700X (8C/16T), 32 GB RAM, ~2.7 TB free on C: |
| ComfyUI | v0.46.0 running at `127.0.0.1:8188`, installed through **Stability Matrix**, PyTorch 2.14 + CUDA 13.0 |
| Checkpoints | `epicrealismXL_pureFix` (photoreal SDXL), `novaFurryXL_ilV150` (stylized Illustrious SDXL), `sd_xl_turbo_1.0` (fast drafts) |
| Other models | VAEs: `wan2.2_vae`, `hidream_vae`. ControlNet: SD1.5 depth only. **No** LoRAs, IP-Adapter, CLIP Vision, text encoders, upscalers, or audio models |
| Incomplete | A 3.1 GB diffusion model download and 2 ControlNet downloads are unfinished (`*.smdownload`). The Wan 2.2 VAE is present but the Wan diffusion model and text encoder are not |
| Nodes | 1,066 nodes. Core local nodes exist for Stable Audio, ACE-Step, Wan, LTX-V and Hunyuan video, but **no models are installed for them**. Many paid cloud API nodes are available but **out of scope** (local-only decision). No local TTS node pack installed |

**What works today:** SDXL images (portraits, backgrounds, UI) ✅ · character consistency ❌ (prompt and seed only) · SFX ❌ · music ❌ · TTS ❌ · video ❌

**Recommended first upgrade set** (each one needs your approval; sizes approximate):
1. **IP-Adapter Plus SDXL + CLIP Vision ViT-H** (~3.5 GB): consistent character faces across portraits. *Highest priority.*
2. **4x upscaler** (e.g. 4x-UltraSharp, ~65 MB): sharp backgrounds from 1024px renders.
3. **Stable Audio Open 1.0 + T5 encoder** (~5 GB): SFX and ambience, fits in 8 GB.
4. **ACE-Step 1.5** (~7–8 GB with offload): music loops. Check speed with a test run.
5. **Local TTS node pack + model** (e.g. Kokoro/F5-class, ~0.3–2 GB): only when voice-over is enabled.
6. **Wan 2.2 TI2V 5B (fp8/GGUF) + UMT5 encoder** *or* **LTX-Video 2B distilled** (~6–10 GB): short (2–5 s), low-resolution (480p) clips only, several minutes each on 8 GB. Treat video as an occasional extra, not a core asset.
7. Finish or delete the 3 incomplete Stability Matrix downloads.

---

## 8. Remaining items to verify while building

1. **Stability Matrix automation:** confirm the current `.cm-info.json` sidecar format and whether Stability Matrix picks up externally added models without a restart. If not, use the Model Browser fallback.
2. **Civitai downloads:** many models need a Civitai API key. Decide whether you add one to Stability Matrix's settings (the agent never handles it) or use the fallback for those models.
3. **LoRA trainer choice:** kohya_ss vs. OneTrainer as the Stability Matrix package. Pick whichever trains SDXL in 8 GB most reliably in a test run.
4. **8 GB music/video speed:** benchmark ACE-Step and Wan 2.2 5B / LTX 2B with a test run before promising them in a project.

---

## 9. Build plan (narrative core first)

### Phase 1 — Narrative core (playable text-only game)
- Plugin skeleton: `plugin.json`, skills, subagents, `/forge:*` commands.
- Orchestrator: `forge.yaml`, `pipeline.json`, `deps.json`, gates, feedback log and routing, impact analysis, git commit/tag on each approval.
- Story Planner (interview → Story Bible + branch map), Engine Advisor (records SugarCube).
- Character Designer (YAML sheets + prose bios).
- Loop Designer, with **one starter module** (stats/relationships), plus `/forge:add-loop`.
- Dialog Writer + **Forge Script spec and compiler** (with tests).
- Builder: Twee 3 output, StoryInit, loop module widgets, save/settings, Tweego compile, dev build with debug overlay, `/forge:playtest`.
- QA: Functional (static + Playwright walks to every ending) and Character/Dialog consistency (voice, knowledge timeline, rating).
- **Done when:** `/forge:new` → interview → approved stages → a playable 30–60 passage text game with every ending reachable and a clean QA report.

### Phase 2 — Assets
- Platform Assessor + `capabilities.yaml`, the Art Direction interview step, and model installs through Stability Matrix.
- ComfyUI client (MCP server or CLI), asset manifest, workflow library, batch approval galleries, background job queue.
- Images first (portraits with IP-Adapter, backgrounds, UI), then SFX/ambience, music, optional voice-over, then video.
- Optional character LoRA training. `/forge:upgrade-assets`.
- The Builder wires up media. Placeholders cover assets the current setup can't make.

### Phase 3 — Optimization, Performance QA & Packaging
- Performance Optimizer, Performance QA with mobile emulation and budgets.
- Packager: itch.io zip, single HTML, static website, desktop (Electron).

### Phase 4 — Polish
- Style profiles library, more loop modules (inventory/puzzles, minigames, exploration/time), and making the Engine Advisor ready for engines beyond Twine.
