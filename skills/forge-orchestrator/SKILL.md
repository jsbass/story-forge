---
name: forge-orchestrator
description: Runs the Twine Forge game-creation pipeline from the main session. Use for any /forge:* command or whenever the user is working inside a Forge project (a folder with forge.yaml): deciding the next stage, delegating to role subagents, presenting approval gates, routing feedback, running impact analysis and the QA fix loop.
---

# Twine Forge orchestrator

You run the pipeline. The role agents do the creative and technical work. You hold the conversation with the user, present the approval gates, and keep state correct.

**CLI:** from the project root, run `node .forge/forge.mjs <cmd>`. Run `node .forge/forge.mjs help` for the full list.

## Stages (Phase 1)

| # | Stage | Who does the work | Artifacts |
|---|---|---|---|
| 1 | `interview` | **You**, using the `story-interview` skill (needs the user) | `design/interview.md` |
| 2 | `bible` | `story-planner` agent, then a check by `engine-advisor` | `design/story-bible.md`, `design/branch-map.yaml` |
| 3 | `characters` | `character-designer` agent | `characters/*.yaml`, `characters/*.md` |
| 4 | `loops` | **You** run the loop conversation (`loop-design` skill), then the `loop-designer` agent writes it up | `design/loops/*` |
| 5 | `script` | `dialog-writer` agent | `script/*.script.md` |
| 6 | `build` | `game-builder` agent | `src/**`, `build/**` |
| 7 | `qa` | `qa-functional` and `qa-character` agents, **in parallel** | `qa/reports/<build>/` |
| 8 | `playtest` | **The user** plays the dev build | feedback |

When the plugin is installed, the agents appear with the plugin prefix (e.g. `forge:dialog-writer`). Use whichever name the Agent tool lists.

## The loop for each stage

1. `node .forge/forge.mjs status`. Check what's next, and look for stale or modified stages and open feedback.
2. `node .forge/forge.mjs stage start <stage>`.
3. Do the work, or delegate it. Give the agent a self-contained brief:
   - the stage
   - the files to read
   - any feedback ids to address (with the text of each)
   - the user's decisions from this conversation that matter
4. **Check the result yourself** before showing it. Read the files the agent wrote, and run `compile`, `build` or `qa static` where they apply. Send the work back to the agent if something is clearly wrong. Never forward an agent report you haven't checked.
5. `node .forge/forge.mjs stage submit <stage>`.
6. **Gate:** present the work to the user. See *Gate format* below.
7. On approval: `node .forge/forge.mjs stage approve <stage> --note "<user's words>"`. This commits and tags `stage/<stage>/vN`.
8. On a change request: `node .forge/forge.mjs stage reject <stage> --note "<user's words>"`. This logs the feedback and routes it. Go back to step 3 with that feedback id.

Gates in `forge.yaml gates:` that are set to `false` may be auto-approved after your own check. All gates are on by default. Never approve on the user's behalf when the gate is on.

## Gate format

Show the user:
- **What was produced:** links to the files, and a 3–6 line summary in the project's own terms (scene and ending counts, the cast, loops and their variables, and so on).
- **Revisions:** what changed since the last version and which feedback ids were addressed. Use `git diff stage/<stage>/v<N> -- <artifacts>` for a short summary.
- **Checks:** the automated results for this stage (compile errors, static QA, the QA summary).
- **Assumptions and questions** the agent raised.
- **The decision:** Approve / Request changes / Roll back.

Ask once, then stop and wait.

## Feedback routing

When the user gives notes, at a gate or at any other time:
1. Work out the target files, then log the feedback:
   `node .forge/forge.mjs feedback add "<user's words>" --target <files> [--stage <s>]`
   The CLI suggests a route (characters/ → character-designer, script/ → dialog-writer, design/loops/ → loop-designer, design/ → story-planner, src/ → game-builder). Override it with `--route` when the note is really about something else, for example "Mara wouldn't say that" goes to dialog-writer, but "Mara should be older" goes to character-designer.
2. **Impact analysis:** run `node .forge/forge.mjs impact <targets>`. If anything downstream would change, show the list and ask whether to regenerate all of it, regenerate selected items, or leave it marked stale.
3. Delegate the fix to the routed agent with the feedback id. When it's done and checked, resolve it with `node .forge/forge.mjs feedback resolve <id> --note "<what changed>"`.
4. A change to an approved stage marks that stage *modified* and every later stage *stale* in `status`. Re-run the gate for the modified stage first, then the stale ones, in order.

Feedback from playtests arrives as `state/feedback/FB-*.md` with `source: playtest`. It includes the passage and a snapshot of the state. Check `feedback list --open` at the start of every session.

## QA fix loop

After `build`, run `qa-functional` and `qa-character` in parallel, then combine their findings:
- **S3/S4:** the QA agents may auto-fix these, up to `limits.qa_fix_retries` attempts. Each fix gets its own commit and a resolved feedback item.
- **S2:** present each one to the user with the proposed fix. Once approved, route it to the owning agent, rebuild, and re-run QA.
- **S1:** these always go to the user. They usually mean a character sheet or plot decision has to change. Run the change through that stage's gate again.

The `qa` stage can be approved when there are no open S1/S2 findings, or when the user explicitly accepts the ones that remain.

## Playtest

1. `node .forge/forge.mjs build`.
2. Start the playtest server. In the Claude desktop app, call `preview_start` with the name `playtest` (from the project's `.claude/launch.json`). Elsewhere, run `node .forge/forge.mjs playtest` in the background and give the user `http://127.0.0.1:4173/`.
3. Tell the user about the ⚙ overlay: jump to any passage, edit variables, see coverage, and send feedback, which is logged straight to `state/feedback/`.
4. When the user is done, triage the new feedback with `feedback list --open` and route it as above. Approve `playtest` only when the user says the game is ready.

## Rollback

`node .forge/forge.mjs rollback stage/<stage>/v<N>` restores that stage's artifacts and commits the result. Then re-approve that stage. Later stages become stale.

## Don'ts
- Don't let agents approve or submit stages. Only you do that, and only after the user approves at the gate.
- Don't regenerate downstream work without the impact list and the user's OK.
- Don't edit generated folders (`src/story`, `src/engine`, `src/modules`).
- Phase 2 features (assets, ComfyUI, optimization, packaging) aren't built yet. Record requests for them as feedback with `--stage assets` and tell the user they're planned.
