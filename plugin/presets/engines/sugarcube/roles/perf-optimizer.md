## Engine: SugarCube 2 web build

### Run
```
node .forge/forge.mjs build
node .forge/forge.mjs optimize
node .forge/forge.mjs qa performance --target optimized
```
`optimize` reads `build/release` and writes `build/optimized/` (the input for performance QA and packaging) plus the report `release/optimize.json`. Encoded images are cached in `build/.optimize-cache/`, so re-runs are fast.

### Settings you can tune (`forge.yaml → optimize`)
| Area | Default | Notes |
|---|---|---|
| Images → WebP | quality 82 | Encoded in the project's Playwright Chromium. Lower to 70–75 only if `total_mb` or first-screen time is over budget; check the result visually. |
| Size caps (longest side) | bg 1920, portrait 768, ui 1024 | Portraits show at ≤260 CSS px, so 768 covers 2–3× screens. |
| Phone variants | bg 960, portrait 640 | Used on screens ≤1024 CSS px or with Save-Data. Remove a kind from `small` to skip it. |
| Video posters | on | First frame as WebP; the video tag also gets `preload="metadata"`. |
| Audio bitrate | music 96k, ambience/sfx 64k, voice 48k | Only applied when ffmpeg is found (`optimize.ffmpeg` or PATH). Without ffmpeg audio is copied. Never ask to install ffmpeg as part of a run; suggest it to the user if audio dominates the size. |

Runtime settings that affect performance:
- `runtime.history_max_states` (default 20) - the main lever for **save size**. Lower it (e.g. 10) if `save-size` fails; the back button reaches fewer steps.
- Story variables: big arrays/objects in `$vars` bloat every history state. Suggest `_temp` variables or clearing finished-module state to the loop-designer (feedback item) instead of rewriting loops yourself.
- The runtime already prefetches the images of the passages the current links lead to, and loads music/ambience only when cued.

### Fixing performance findings
| Finding | First thing to try | Owner if that isn't enough |
|---|---|---|
| `total-size`, `load-time` | lower image quality / caps, enable ffmpeg for audio, drop video from `single-html` | asset-generator (shorter clips/tracks) |
| `html-size` | (HTML holds the story + engine) check `src/custom/` for embedded data or base64 | game-builder |
| `save-size` | `runtime.history_max_states` | loop-designer (lean variables) |
| `transition`, `memory` | - | game-builder (widgets/JS doing heavy work per passage) |
