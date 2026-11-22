---
description: Log feedback on any part of the game, route it to the right agent and show its impact
argument-hint: <your note>
---

Feedback from the user: $ARGUMENTS

Follow the *Feedback routing* section of the `forge-orchestrator` skill:
1. Work out which files the note is about. Search `script/` and `characters/` for the names or lines it mentions.
2. Log it with `node .forge/forge.mjs feedback add "<the user's words>" --target <files>`, overriding `--route` if the suggested route is wrong.
3. Run `node .forge/forge.mjs impact <files>` and show the user anything downstream.
4. Ask whether to apply it now. On a yes, delegate to the routed agent, check the result, resolve the feedback item, and re-run the gate for the affected stage.
