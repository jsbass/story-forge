---
description: Optimize the release build (images, posters, audio) and check it against the performance budgets
---

Delegate to the `perf-optimizer` agent: rebuild, run `node .forge/forge.mjs optimize`, then `node .forge/forge.mjs qa performance --target optimized`, and tune `forge.yaml → optimize` / `runtime` settings until the budgets pass (within the retry limit).

Then show the user: media size before → after, the phone vs desktop numbers against each budget, any settings that changed, and anything still over budget with a proposed fix. If the `optimize` stage is awaiting approval, present the gate.
