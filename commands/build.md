---
description: Build the Twine Forge game (dev + release HTML) and run static checks
---

1. Run `node .forge/forge.mjs build`. If it fails, delegate the fix to the `game-builder` agent. Script problems go to the `dialog-writer` as feedback.
2. Run `node .forge/forge.mjs qa static` and summarise the result by severity.
3. Report the build id and the output paths. Offer `/forge:playtest` or `/forge:qa`.
