---
description: Optimize, run the final QA pass on the shipped build, and package every distribution target
argument-hint: [targets...]
---

Release the game: $ARGUMENTS (default: every target in `forge.yaml → distribution`)

1. Check `/forge:status`: the stages up to `playtest` should be approved. If not, tell the user which are open and ask whether to release anyway (e.g. a preview build).
2. Run `node .forge/forge.mjs release`. It builds, optimizes, re-runs the playthroughs on the optimized build, runs performance QA, then packages. Use `node .forge/forge.mjs package <targets>` instead if only some targets are wanted and QA has just passed.
3. If QA fails: don't ship. Route the findings (qa-functional / qa-performance agents) and come back.
4. Follow the release section of `forge/roles/orchestrator.md` and `forge/roles/game-packager.md` (engine-specific targets). Anything that downloads tools (e.g. building desktop executables) needs the user's yes first.
5. Show the user every target with path and size, plus warnings. Offer publishing only if it's configured or they ask, and publish only after their explicit approval (they log in to publishing tools themselves).
6. Submit the `release` stage and present the gate: `node .forge/forge.mjs stage submit release`.
