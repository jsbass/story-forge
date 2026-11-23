# Using Story Forge

This guide walks through making a game with Story Forge, from creating a project to packaging a release. It lists every command and gives example prompts that let Claude Code work on its own until it reaches a review point or needs an answer from you.

For the design behind the pipeline, see [SPEC.md](SPEC.md). For engines and adapters, see [engines.md](engines.md). For the dialog format, see [forge-script.md](forge-script.md).

---

## 1. Install

You need Node.js 20 or later, git (with `user.name` and `user.email` set), and Claude Code.

```powershell
claude plugin install <path-to>/story-forge/plugin
```

You can also add the repository as a marketplace (it includes `.claude-plugin/marketplace.json`). The commands are namespaced `/forge:*`. The agents appear as `forge:<role>`, for example `forge:dialog-writer`.

Optional, for generated art, audio and video: a local ComfyUI (for example through Stability Matrix). Run `/forge:assess` to see what your machine can generate. Without it, pass `--assets none` when creating the project and the game uses placeholders.

---

## 2. How the pipeline works

A project moves through 11 stages. Each stage ends at a **gate**: Claude shows you what was produced and waits for **Approve**, **Request changes** or **Roll back**. Approving a stage commits it and tags it `stage/<name>/vN` in the project's git repository.

| # | Stage | Who does it | What it produces | Needs you? |
|---|---|---|---|---|
| 1 | `interview` | Claude, with you (`story-interview` skill). Includes art direction. | `design/interview.md` | **Yes.** It's a conversation. |
| 2 | `bible` | `story-planner`, then `engine-advisor` | `design/story-bible.md`, `design/branch-map.yaml`, the engine choice | To approve the engine and its downloads |
| 3 | `characters` | `character-designer` | `characters/*.yaml`, `characters/*.md` | Gate only |
| 4 | `loops` | Claude, with you (`loop-design` skill), then `loop-designer` | `design/loops/*` | **Yes.** Short design conversation. |
| 5 | `script` | `dialog-writer` | `script/*.script.md` | Gate only |
| 6 | `assets` | `asset-generator`, then your review in the gallery | `assets/manifest.yaml`, `assets/final/**` | **Yes.** Only you can approve assets. |
| 7 | `build` | `game-builder` | `src/**`, `build/dev`, `build/release` | Gate only |
| 8 | `optimize` | `perf-optimizer` | `build/optimized`, `release/optimize.json` | Gate only |
| 9 | `qa` | `qa-functional`, `qa-character`, `qa-performance` (in parallel) | `qa/reports/<build>/` | For S1/S2 findings |
| 10 | `playtest` | **You** play the dev build | feedback | **Yes** |
| 11 | `release` | `game-packager` | `dist/**`, `release/release.json` | To approve downloads and publishing |

What Claude **always** stops for, whatever your settings:
- any download or install (engine tools, models, Electron), with its size and licence shown
- approving generated assets
- publishing anywhere
- QA findings at severity S1, and S2 findings (including any performance budget failure)
- questions the agents raise that only you can answer (plot decisions, a design that needs a different engine)

Editing an approved stage marks it *modified* and every later stage *stale*. `/forge:status` shows this, and Claude re-runs the gates in order.

---

## 3. Commands

### Slash commands (in Claude Code)

| Command | What it does |
|---|---|
| `/forge:new <folder> [title]` | Creates a game project (asks you to confirm first), then starts the concept interview |
| `/forge:status` | Shows where the pipeline is, what's stale or modified, open feedback, and the recommended next step |
| `/forge:next [stage]` | Runs the next stage (or the one named) up to its gate, then stops |
| `/forge:approve [stage] [note]` | Approves the stage waiting at its gate. Commits and tags it. |
| `/forge:reject [stage] <changes>` | Requests changes. Logs feedback, shows the impact, and sends the work back to the owning agent. |
| `/forge:feedback <note>` | Logs a note about anything, routes it to the right agent, and shows what else it would affect |
| `/forge:rollback <stage> [version]` | Restores a previously approved version of a stage |
| `/forge:engine` | Checks which engine fits the design, and installs that engine's pack once you approve |
| `/forge:style [list\|show\|apply\|save]` | Lists, shows, applies or saves style profiles (prose, art, UI theme, audio) |
| `/forge:add-loop [idea]` | Designs and adds a gameplay loop mid-project, with an impact analysis |
| `/forge:assess` | Shows your GPU and ComfyUI status, what assets you can generate, and upgrade options |
| `/forge:assets [kind or ids]` | Generates a batch of assets and opens the review gallery |
| `/forge:upgrade-assets` | Installs models you approve, then generates or regenerates the assets they unlock |
| `/forge:build` | Builds the dev and release HTML and runs static checks |
| `/forge:playtest` | Opens the dev build with the ⚙ debug overlay and in-game feedback |
| `/forge:qa [functional\|character\|performance\|all]` | Runs QA on the latest build |
| `/forge:optimize` | Optimizes media and checks the performance budgets |
| `/forge:release [targets...]` | Final QA on the optimized build, then packages every distribution target |

### The `forge` CLI

The agents use the CLI. You can run it yourself from the project root:

```powershell
node .forge/forge.mjs help
```

The ones you are most likely to want directly:

| CLI command | Use |
|---|---|
| `status` | Pipeline state, stale artifacts, open feedback |
| `feedback list --open` | Everything still waiting to be addressed |
| `impact <file\|folder/>` | What depends on a file, if you edit it by hand |
| `compile` | Check the scripts parse, without building |
| `build [--dev-only]` | Build the game |
| `playtest` | Serve the dev build at `http://127.0.0.1:4173/` |
| `assets review` | Serve the asset gallery at `http://127.0.0.1:4174/` |
| `engine list` / `engine check` | Engines Story Forge knows, and how the design fits each |
| `pack list` / `pack plan <id>` | Installed preset packs, and what one would download |
| `style list` | Built-in and saved style profiles |
| `release` | Build, optimize, QA and package in one go |

---

## 4. Walkthrough

### Create the project

```
/forge:new C:\games\lantern-keeper "The Lantern Keeper"
```

Claude explains what will be written (`forge.yaml`, pipeline state, role playbooks in `forge/roles/`, the `yaml` npm package, and the asset pack's files) and asks you to confirm. Nothing large is downloaded yet. The engine's tools come later, once the engine is chosen.

Open Claude Code in the new folder for the rest of the work (the desktop app can move the session there for you).

### 1. Interview

Claude asks about the premise, tone, length, content rating, cast, endings and look of the game. It offers style profiles (`/forge:style list`) and walks you through art direction: quick sample images and which image model to use. Answer in as much or as little detail as you like. You can tell it to pick sensible defaults for anything you don't care about.

### 2. Story bible and engine

The story planner writes the bible and a branch map. The engine advisor checks the design against the engines it knows. It flags anything the recommended engine handles badly (real-time combat, for example) and proposes alternatives. Approve the engine and its download list (for SugarCube: Playwright, Chromium ~150 MB and the story format), then approve the bible.

### 3–5. Characters, loops, script

- **Characters:** structured sheets (voice, phrases they never say, what they know and when, arc, relationships). QA checks every line against these later.
- **Loops:** a short conversation about gameplay systems (stats, inventory, minigames, exploration), then a write-up of each loop and how it gates branches.
- **Script:** the scenes in Forge Script, written in two passes: structure first, then each character's voice.

### 6. Assets

Assets are generated in batches: character reference portraits, then backgrounds, then the remaining portraits, UI, sound effects and ambience, music, and video. After each batch the review gallery opens. Approve a candidate or reject it with a note, in the gallery or in chat. You can also accept placeholders for anything you don't want generated.

### 7–9. Build, optimize, QA

The game is built (`build/dev` includes the debug overlay; `build/release` doesn't), optimized for size and phones, and checked by three QA agents in parallel:
- **Functional:** static graph checks and automated playthroughs.
- **Character:** every line against the speaker's sheet and the content rating.
- **Performance:** load time, transitions, memory, save size and build weight on desktop and phone profiles, against the budgets in `forge.yaml`.

Minor findings (S3/S4) are fixed automatically, each in its own commit. Serious ones (S1/S2) come to you with a proposed fix.

### 10. Playtest

```
/forge:playtest
```

Play the dev build. The ⚙ overlay lets you jump to any passage, edit variables, see coverage, and send feedback from the exact spot you're in. When you're done, tell Claude and it triages everything you sent.

### 11. Release

```
/forge:release
```

Rebuilds, optimizes, re-runs QA on the build you will actually ship, and packages each target in `forge.yaml → distribution`: itch.io zip, single HTML file, web folder, and an Electron desktop wrapper. Building desktop executables downloads Electron and needs your approval. Publishing to itch.io uses butler, which you install and log in to yourself.

### Giving feedback at any time

You don't have to wait for a gate:

```
/forge:feedback Mara sounds too cheerful in the lighthouse scene
/forge:feedback The storm music is too loud compared to the dialog
```

Claude finds the files the note is about, routes it to the right agent, shows what else would change, and asks before applying it.

---

## 5. Letting Claude work on its own

By default every stage stops at its gate. You have two ways to let Claude go further between check-ins.

### Option A: turn gates off in `forge.yaml`

```yaml
gates:
  interview: true      # keep: you're needed anyway
  bible: true          # keep: sets the direction for everything after it
  characters: false    # Claude checks the work itself, then approves and moves on
  loops: true
  script: false
  assets: true         # asset approval is always yours, whatever this says
  build: false
  optimize: false
  qa: false            # S1/S2 findings still stop and come to you
  playtest: true
  release: true
```

When a gate is `false`, Claude still checks the work (compiles, builds, runs static QA) before approving it, and still stops for downloads, asset approval, serious QA findings and open questions. Every stage is still committed and tagged, so `/forge:rollback` works the same.

### Option B: say so in your prompt

Leave the gates on and tell Claude how far to go. It runs each stage, approves only the gates you said to, and stops at the first point that needs you. The examples below work with either option.

### Example prompts

**Start a game and get through the interview quickly**

> Create a new Story Forge project in `C:\games\salt-and-ash` called "Salt and Ash". It's a short gothic mystery on a fishing island, rated T, about 30 minutes long, with three endings. Use the storm-gothic style profile. Ask me only the interview questions you can't reasonably answer from this, and pick sensible defaults for the rest. Stop when the interview is ready for my approval.

**Run the narrative stages until the first real decision**

> Run the Story Forge pipeline from where it is. Approve the characters and script gates yourself once your own checks pass. Stop and ask me when you reach the engine decision or its downloads, the loop design conversation, a question you can't answer from the story bible, or the assets stage.

**Draft everything with placeholders, so I can play it early**

> Take this project from the approved bible to a playable dev build as fast as possible. Approve characters, loops, script and build yourself after your checks. Skip asset generation and use placeholders for every asset. Then start the playtest and tell me where to open it. Only stop earlier if something fails twice or a decision changes the plot.

**Generate assets in the background while I review**

> Generate the next asset batch for the Story Forge project in the background. Start with the character reference portraits, then backgrounds. Open the review gallery when the first batch is ready and keep generating the next batch while I review. Don't approve any assets yourself.

**Fix QA findings without bothering me**

> Run full Story Forge QA on the latest build. Let the QA agents auto-fix everything at S3/S4, rebuild and re-run QA until it's clean or you hit the retry limit. Bring me only S1/S2 findings, each with your proposed fix, and the final PASS/FAIL.

**Apply my playtest notes**

> I've finished playtesting. Triage all the open feedback, show me the impact, then apply every note that only touches the script or UI without asking. Ask me about anything that changes a character sheet, the branch map or a loop. Rebuild and re-run QA after, then stop at the QA gate.

**Get to a release candidate**

> Take this Story Forge game from its current state to a release candidate. Approve build, optimize and QA gates yourself if your checks pass and no S1/S2 findings are open. Package the itch.io zip and single HTML targets, but don't build desktop executables or publish anything. Stop at the release gate and show me each package with its size.

**Overnight run**

> Work through the Story Forge pipeline unattended for as long as you can. Treat every gate set to false in forge.yaml as yours to approve after your checks. When you reach anything that needs me (a gate that's on, a download, asset approval, an S1/S2 finding, or a question), stop there, and leave a summary of what you did, what's committed, and exactly what you need from me.

### Tips for long autonomous runs

- **Write lasting instructions into the playbooks.** When you tell Claude something that should always hold ("keep Wren's lines under 20 words", "always upscale backgrounds"), ask it to add the instruction to that role's project notes in `forge/roles/<role>.md`. Every later run reads them.
- **Give the interview real detail.** The more the interview and bible settle, the fewer questions come up later.
- **Approve downloads up front.** If you know you want SugarCube and specific models, approve the engine pack and model installs early, so later runs don't stop for them.
- **Check `/forge:status` when you come back.** It shows exactly what changed, what's stale and what's waiting on you.
- **Nothing is lost.** Every approval is a git tag. If an autonomous run goes somewhere you don't like, `/forge:rollback <stage>` restores the last version you approved.
