---
description: Optimize, run the final QA pass on the shipped build, and package every distribution target
argument-hint: [targets...]
---

Release the game: $ARGUMENTS (default: every target in `forge.yaml → distribution`)

1. Check `/forge:status`: the stages up to `playtest` should be approved. If not, tell the user which are open and ask whether to release anyway (e.g. a preview build).
2. Run `node .forge/forge.mjs release`. It builds, optimizes, re-runs the playthroughs on the optimized build, runs performance QA, then packages. Use `node .forge/forge.mjs package <targets>` instead if only some targets are wanted and QA has just passed.
3. If QA fails: don't ship. Route the findings (qa-functional / qa-performance agents) and come back.
4. Desktop: the app source is always written. Building executables downloads Electron (~100 MB). **Ask the user**, and only on a yes run `node .forge/forge.mjs package desktop --build --yes`.
5. Show the user every target with path and size, plus warnings. Offer publishing to itch.io only if `distribution_settings.itch.project` is set or they ask, and run `node .forge/forge.mjs publish itch --yes` only after their explicit approval (they install and log in to butler themselves).
6. Submit the `release` stage and present the gate: `node .forge/forge.mjs stage submit release`.
