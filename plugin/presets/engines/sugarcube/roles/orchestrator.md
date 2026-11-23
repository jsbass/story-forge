## Engine: SugarCube 2

### Playtest
1. `node .forge/forge.mjs build`.
2. Start the playtest server. In the Claude desktop app, call `preview_start` with the name `playtest` (from the project's `.claude/launch.json`). Elsewhere, run `node .forge/forge.mjs playtest` in the background and give the user `http://127.0.0.1:4173/`.
3. Tell the user about the ⚙ overlay in the dev build: jump to any passage, edit variables, see coverage, and send feedback, which is logged straight to `state/feedback/` with the passage and a state snapshot.

### Optimize and release
- `optimize` (after `build`): the `perf-optimizer` writes `build/optimized/` (WebP images, phone variants, video posters) and tunes `forge.yaml → optimize` / `runtime` until `qa performance` meets `performance.budgets`. Gate: show media size before → after and the phone vs desktop numbers.
- `release`: `node .forge/forge.mjs release` rebuilds, optimizes, re-runs the playthroughs **on the optimized build**, runs performance QA, then packages every target in `forge.yaml → distribution` (itch zip, single HTML, web, Electron desktop source) into `dist/` and records them in `release/release.json`.
- **Approval needed, every time:** desktop executables (`package desktop --build --yes`) download Electron (~100 MB+); publishing (`publish itch --yes`) is public. The user installs and logs in to butler themselves.
