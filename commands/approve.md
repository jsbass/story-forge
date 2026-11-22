---
description: Approve the Twine Forge stage that is waiting at its gate
argument-hint: [stage] [note]
---

Approve a Twine Forge stage: $ARGUMENTS

1. Run `node .forge/forge.mjs status --json`. The stage to approve is the one named in the arguments, or else the one that's `awaiting_approval`. If there's more than one candidate, or none, ask.
2. Run `node .forge/forge.mjs stage approve <stage> --note "<the user's note, if any>"`. This commits and tags `stage/<stage>/vN`.
3. Report the tag. If other stages are now stale, say so, then name the next stage and offer to run it.
