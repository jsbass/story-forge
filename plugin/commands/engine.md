---
description: Check which game engine fits this design (blockers, risks, alternatives) and record the decision
---

Delegate to the `engine-advisor` agent: it runs `node .forge/forge.mjs engine check`, weeds out keyword false positives, proposes alternatives the recommended engine handles well, and prepares the decision.

Show the user: the recommended engine, each blocker or risk with the proposed alternative, and any engine that would fit better but that Twine Forge can't build yet. If the design needs a decision (e.g. drop real-time combat, or plan for another engine), ask once and wait.

Setting the engine installs its preset pack into the project, so also show what it downloads (`node .forge/forge.mjs pack plan <engine>`, e.g. for SugarCube: Playwright, its Chromium browser (~150 MB) and the story format). On the user's yes, run `node .forge/forge.mjs engine set <engine> --rationale "..." --yes`. If they want to choose now but download later, use `--skip-setup` and run `forge pack install <engine> --yes` when they're ready. Afterwards, tell them which playbooks gained an engine section (`forge/roles/`).
