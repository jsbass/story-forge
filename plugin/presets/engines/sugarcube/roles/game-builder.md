## Engine: SugarCube 2 (Twine)

### What `forge build` does
1. Compiles `script/*.script.md` into `src/story/*.twee` (generated; never edit by hand).
2. Generates `src/engine/*` from the project's runtime in `forge/engine/runtime/`, and `StoryInit` from the variables owned by loop modules, character `affinity_var`s, branch-map `variables` and `forge.yaml vars`.
3. Copies each loop module's widgets, JS and CSS from `forge/engine/modules/<type>/` into `src/modules/` (also generated).
4. Includes everything in `src/custom/` (yours to edit): `.twee`, `.js` and `.css`.
5. Writes `build/dev/index.html` (with the ⚙ debug overlay) and `build/release/index.html`, plus a combined `story.twee` for each that can be imported into the Twine 2 editor.

### What Forge Script compiles to
| Forge Script | SugarCube |
|---|---|
| narration | `<p>…</p>` |
| `MARA (quiet): text` | `<<forge_say "mara" "quiet">>text<</forge_say>>` |
| `@bg id`, `@portrait mara worried` | `<<forge_media "bg" "id">>`, `<<forge_media "portrait" "mara" "worried">>` |
| `> set …` | `<<set …>>` |
| `?? if` / `?? end` | `<<if>>` / `<</if>>` |
| `* [Label] -> target {mods}` | `<<link "Label" "target">>` (+ `<<set>>`/macro for modifiers) |
| `END id "Title"` | `ending` tag + `<<forge_ending "id" "Title">>` |

Generated folders: `src/story`, `src/engine`, `src/modules`. To change the runtime or a module for this project only, edit `forge/engine/runtime/` or `forge/engine/modules/` (the project's copy) and note why in this playbook's project notes.

### Missing features
When a design is marked `needs-module`, write it as custom SugarCube code in `src/custom/`: `<<widget>>` passages plus a JS file with `setup.forge.*` helpers. Document it at the top of the file.

### SugarCube conventions
- The story format is installed in `vendor/sugarcube-2/` (version in `forge.yaml format.version`). Use v2.37 APIs (`Story.filter`, `Save.browser`, container widgets with `_contents`).
- Keep story state in `$variables`, and helpers on `setup.forge`.
- Release builds drop passages tagged `debug`. Put dev-only helpers there.
- The runtime exposes `window.__forgeTurn` / `window.__forgePerf` for QA; don't remove them from custom code paths.
