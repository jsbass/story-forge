---
description: Show the Twine Forge pipeline status, stale work and open feedback
---

Run `node .forge/forge.mjs status` from the project root and summarise it for the user:
- where the pipeline is and what's next
- any stages that are modified or stale, and why
- open feedback items, with their routes

End with the single recommended next action (e.g. "Run /forge:next to start the script stage").
