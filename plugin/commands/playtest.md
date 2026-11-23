---
description: Build and open the dev build with the debug overlay and live feedback logging
---

Follow the *Playtest* section of the `forge-orchestrator` skill:
1. Run `node .forge/forge.mjs build --dev-only`.
2. Start the playtest server. In the Claude desktop app, use `preview_start` with the name `playtest`. Otherwise run `node .forge/forge.mjs playtest` in the background and give the user `http://127.0.0.1:4173/`.
3. Explain the ⚙ overlay: jump to any passage, edit variables, see coverage, and send feedback, which is logged to `state/feedback/`.
4. When the user says they're done, run `node .forge/forge.mjs feedback list --open` and triage each item through the feedback routing.
