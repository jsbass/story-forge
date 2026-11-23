---
description: Check which game engine fits this design (blockers, risks, alternatives) and record the decision
---

Delegate to the `engine-advisor` agent: it runs `node .forge/forge.mjs engine check`, weeds out keyword false positives, proposes SugarCube-friendly alternatives for risky features, and records the decision with `forge engine set`.

Show the user: the recommended engine, each blocker or risk with the proposed alternative, and any engine that would fit better but that Twine Forge can't build yet. If the design needs a decision (e.g. drop real-time combat, or plan for another engine), ask once and wait.
