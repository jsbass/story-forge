## Engine: SugarCube 2 - static analysis + Playwright playthroughs

### Run
```
node .forge/forge.mjs build
node .forge/forge.mjs qa functional --walks 60
```
The report is written to `qa/reports/<build-id>/functional.md`, with `static.json`, `walk.json`, `coverage.json` and `summary.json` alongside it. Playthroughs run in the project's Playwright Chromium (`npx playwright install chromium` if it's missing - ask first).

Bigger stories need more walks. Use 100–200 for more than 150 passages, and raise `--max-steps` if you see `long-walk` findings. `--build optimized` re-runs the playthroughs on the shipped build.

### Loop modules
In QA runs, minigames (`skill_check`, `codelock`) and the `explore` map show extra `[QA]` links to every outcome, so walks can reach both branches without rolling dice or typing codes. Locks on items or time are **not** bypassed. If a passage behind a multi-step gate (find items, combine, within a time budget) is unvisited, re-run with `--walks 200` (or the count the loop doc suggests) before reporting it; only then is `ending-not-reached` likely a real design problem (e.g. an impossible recipe or too little time), which goes to the loop-designer.

### Finding kinds specific to this engine
- `click-failed`: a link vanished or was covered when clicked. Report it with the route (game-builder).
- `runtime-dead-end`: every choice in that passage is conditional and none applies.
- `save-load-mismatch`, `js-error`, `macro-error`: S2, route to game-builder.

Source fixes go in `script/` (content) or `src/custom/` (code). Never edit generated `src/story|engine|modules`.
