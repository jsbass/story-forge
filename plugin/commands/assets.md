---
description: Generate and review game assets (images, audio, video) with the project's asset tool
argument-hint: [kind or asset ids]
---

Run the assets stage, or a batch of it: $ARGUMENTS

Follow the *Assets* section of the `forge-orchestrator` skill and the asset-tool section of `forge/roles/orchestrator.md`:
1. `node .forge/forge.mjs assets sync`, then `node .forge/forge.mjs assets list`.
2. Delegate prompting and generation to the `asset-generator` agent. Name a batch: one kind (e.g. `bg`), the given ids, or the character reference portraits first. Run long batches in the background.
3. Open the review gallery. In the Claude desktop app, start `node .forge/forge.mjs assets review` in the background and open `http://127.0.0.1:4174/` in the browser pane. Otherwise point the user at `assets/review/index.html`.
4. The user approves or rejects in the gallery, or tells you in chat (`assets approve <id> --candidate n`, `assets reject <id> --note "…"`). Send rejections back to the asset-generator.
5. When every needed asset is approved, or the user accepts placeholders for the rest, submit the `assets` stage and present its gate.
