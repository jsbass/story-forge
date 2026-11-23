## Asset tool: local ComfyUI (Stability Matrix)

### Check the platform
```
node .forge/forge.mjs assess
```
Tell the user what this machine can make now (images, sfx, music, video) and what it can't. Mention any unfinished Stability Matrix downloads it lists. It also writes `forge/assets/models.lock.json`.

### Samples
For each proposed style, pick which **installed** checkpoint suits it (the `assess` checkpoint list includes each model's base and tags) and make a quick sample where one fits:
```
node .forge/forge.mjs assets set bg:<some_bg_id> --prompt "<style words>, <scene>"
node .forge/forge.mjs assets generate bg:<some_bg_id> --draft --count 2
```
Show the images with the Read tool. Drafts are SDXL-Turbo, so they only *suggest* the style.

### Pick or install models
- If an installed checkpoint suits the chosen style, use it.
- Otherwise search Civitai for checkpoints (or style LoRAs) that fit the GPU (SDXL, Illustrious and Pony bases fit 8 GB):
  ```
  node .forge/forge.mjs models search "<style keywords>" [--type LORA]
  ```
  Show 2–4 options with name, base, size, downloads and page link. Check each licence (commercial use) if the user plans to sell the game.
- **Install only after the user explicitly approves the specific model:** `node .forge/forge.mjs models install-civitai <versionId> --yes`. This downloads into Stability Matrix's shared `Models\` folder (once per machine, shared by all projects). If Civitai needs a login for the file, relay the printed Stability Matrix Model Browser steps.
- For the capability upgrades in `assess` (character consistency, upscaler, sfx, music, video), list each with size, licence and what it unlocks. Ask which to install, then `node .forge/forge.mjs models install <id> --yes` for each approved item. A node pack (IP-Adapter) needs `models node-pack <id> --yes` and a ComfyUI restart, which the user does in Stability Matrix.
- Gated models (Stable Audio Open) can't be downloaded by Forge. Give the user the printed instructions.
- Afterwards, run `node .forge/forge.mjs assess` again to confirm, and so the models lock is current.

### Record
`forge.yaml art.checkpoint` is the ComfyUI checkpoint file name. `art.defaults` can pick workflows per kind, e.g. `bg: { workflow: sdxl-image-upscale }` once upscaling is ready.

### Mid-project upgrades (/forge:upgrade-assets)
`assess` compares the new scan with the previous one and prints **now possible** (blocked assets now unblocked) and **could be regenerated** (e.g. portraits made before IP-Adapter was available).
