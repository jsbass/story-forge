# Engines and adapters

Twine Forge keeps the creative work engine-neutral and puts everything engine-specific behind an **adapter**.

| Engine-neutral (works for any engine) | Engine-specific (the adapter) |
|---|---|
| `design/` (interview, bible, branch map, loop designs) | turning scripts into the engine's source format |
| `characters/` (sheets, bios) | the runtime: media playback, loop-module code, settings, debug overlay |
| `script/*.script.md` (Forge Script) | building `build/<mode>/` and `build/build-info.json` |
| `assets/` (manifest, approved media) | QA hooks the walker and performance QA use |
| `forge.yaml` (rating, art, style, budgets) | which packaging targets make sense |

## What exists

- `engines.json` - the catalog the Engine Advisor scores designs against: features, and for each engine a fit (`yes` / `partial` / `no`) plus `forge_support` (`supported`, `planned`, `not-planned`).
- `tools/engines/index.mjs`
  - `ADAPTERS` - engines Twine Forge can build. Today: `sugarcube`.
  - `engineFor(config)` - the adapter for `forge.yaml → engine.name`; `forge build` and `forge release` go through it.
  - `detectNeeds(root)` / `fitReport(needs)` - `forge engine check`.
  - `setEngine(root, name)` - `forge engine set` (buildable engines only).

## Adding an adapter

An adapter is an object in `ADAPTERS`:

```js
myengine: {
  id: 'myengine',
  label: 'My Engine',
  build: async (root, { modes }) => buildInfo,   // writes build/<mode>/..., build/build-info.json, build/script-manifest.json
  qa: { static: true, functional: true, performance: true, character: true },
  packaging: ['web', 'desktop'],
  loopModules: 'modules-myengine/',              // its own implementations of the loop modules
}
```

Contract the rest of the pipeline relies on:

1. **build-info.json** with `id`, `title`, `start`, `endings`, `outputs.<mode>.{html, bytes, mediaFiles, mediaBytes}`, `media.{referenced, available, missing}` - status, QA and packaging read it.
2. **script-manifest.json** with `lines`, `links`, `media`, `endings`, `variables`, `invariants`, `moduleLinks` - character QA and static QA read it.
3. **A passage-level story file** for static QA (SugarCube writes `build/<mode>/story.twee`); another engine can write an equivalent list of `{name, tags, text}` or provide its own static analysis.
4. **Runtime QA hooks** in every build (see `engine/core.js`):
   - `window.__forgeTurn` - increments after each passage/screen is shown
   - `window.__forgePerf` - `{ first, transitions[] }` timings
   - `window.__forgeQA` - set by the QA tools before load; minigame-like UI must then expose links to every outcome
   - choices as `a[data-passage]` links inside `#passages`, and `window.SugarCube`-like access to the current passage, tags and variables (the walker in `tools/qa/walker.mjs` is the place to generalise when a second engine arrives)
5. **Loop modules**: the same `loops.yaml` contract (`variables`, `invariants`, `links`, `lint`) with engine-specific runtime code.
6. **Media**: read `assets/manifest.yaml` (approved files) and honour the cue semantics in `skills/forge-script/reference.md`.

Then mark the engine `"forge_support": "supported"` in `engines.json`.

## Likely next adapters

- **Harlowe** - same Twine HTML packaging; needs a Forge Script → Harlowe compiler and Harlowe versions of the loop modules.
- **ink (inkjs)** - Forge Script maps well onto ink knots/stitches/choices; strongest for very large stories and for handing a narrative to Unity/Godot projects.
- **Ren'Py** - for visual-novel staging and native desktop/mobile builds; Forge Script speaker lines map directly onto Ren'Py dialogue.
