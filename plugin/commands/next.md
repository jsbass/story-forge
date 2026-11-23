---
description: Run the next Twine Forge pipeline stage up to its approval gate
argument-hint: [stage]
---

Use the `forge-orchestrator` skill.

1. Run `node .forge/forge.mjs status --json`. Choose the stage: $ARGUMENTS if given, otherwise `next`. A modified or stale stage takes priority over a pending one.
2. Address any open feedback routed to that stage's owner as part of the work.
3. Run the stage loop: start, then do or delegate the work, check the result yourself, submit, and present the gate.
4. Stop at the gate and wait for the user's decision.
