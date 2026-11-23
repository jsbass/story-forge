## Engine: SugarCube 2 web build - headless Chromium measurements

### Run
```
node .forge/forge.mjs optimize          # if build/optimized is older than the last build
node .forge/forge.mjs qa performance    # tests build/optimized, plus dist/web and dist/single if packaged
```
Use `--target optimized,web,single-html` to choose. The report is `qa/reports/<build-id>/performance.md` (+ `performance.json`).

### What is measured
| Check | Profile | Budget key (`forge.yaml → performance.budgets`) |
|---|---|---|
| First passage on screen | phone | `first_passage_ms` (2000) |
| Click → next passage painted, 95th percentile | phone | `transition_ms` (100) |
| index.html size | - | `html_kb` (2048) |
| Whole build size | - | `total_mb` (100) |
| Largest save (base64) during the session | both | `save_kb` (100) |
| JS heap growth over the long session | desktop | `heap_growth_mb` (20) |
| JS errors / console errors / stuck clicks | both | always S2 / S3 |

The phone profile (`performance.mobile`) defaults to 390×844 @3x, CPU 4× slower, 9 Mbps / 150 ms. The long session is `performance.long_session` (500) random transitions, restarting at endings. Timings come from the game's own hooks (`window.__forgePerf`), so they measure what the player sees.

Lighthouse is not used (no extra dependency); if the user wants a Lighthouse score, suggest running it in Chrome DevTools against `forge playtest`.

### Routing
Save size → `loop-designer` if it comes from story variables; transition/memory → `game-builder`; size/load time → `perf-optimizer`.
