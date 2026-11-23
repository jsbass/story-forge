---
description: Request changes to the Story Forge stage at its gate
argument-hint: [stage] <what should change>
---

Request changes: $ARGUMENTS

1. Identify the stage (named in the arguments, or else the one `awaiting_approval`) and the user's notes. If the notes are missing, ask for them.
2. Run `node .forge/forge.mjs stage reject <stage> --note "<the user's words>"`. This logs a feedback item routed to the stage owner.
3. Run impact analysis on the files affected (`node .forge/forge.mjs impact <files>`) and mention anything downstream.
4. Delegate the revision to the owning agent with the feedback id, check the result, resubmit, and present the gate again (see the `forge-orchestrator` skill).
