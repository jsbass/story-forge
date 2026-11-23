## Engine: SugarCube 2 web build - distribution targets

```
node .forge/forge.mjs package                 # every target in forge.yaml → distribution
node .forge/forge.mjs package itch web        # just these
```
Results go to `dist/` (git-ignored) and `release/release.json` (committed: what was produced from which build).

| Target | Output | Checks |
|---|---|---|
| `itch` | `dist/itch/<game>-<version>-html5.zip` | itch.io HTML5 rules: index.html at the root, ≤1000 files, ≤500 MB extracted, ≤200 MB per file, paths ≤240 chars, case-exact relative URLs |
| `single-html` | `dist/single/<game>.html` | every asset inlined as base64 (one image size only); fails above `distribution_settings.single_html_max_mb` (25) unless `--force`; warns about inlined video |
| `web` | `dist/web/` | hashed media filenames for long caching, relative paths, `_headers` with cache hints (Netlify/Cloudflare Pages format) |
| `desktop` | `dist/desktop/app/` (+ `dist/desktop/<name>-<platform>-<arch>/`) | Electron wrapper: sandboxed window, external links open in the browser, F11 / Alt+Enter fullscreen, saves in the per-user app data folder |

### Needs the user's explicit approval first
1. **Desktop executables** download Electron and @electron/packager from npm (~100 MB+) into the project: ask, then run `node .forge/forge.mjs package desktop --build --yes`. Platforms come from `distribution_settings.desktop.platforms` (win32 default; darwin/linux builds are unsigned).
2. **Publishing to itch.io** is public: show the user `node .forge/forge.mjs publish itch` (prints the butler command), and only run it with `--yes` after they approve. The user installs butler and logs in (`butler login`) themselves - never handle their API key. After the first push they set the itch page to "HTML" and mark the channel as playable in browser.
