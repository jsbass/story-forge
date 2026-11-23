---
name: art-direction
description: Runs the Twine Forge Art Direction step with the user - choose an art style, see quick samples, pick or install suitable models through Stability Matrix, and record the result in forge.yaml art. Use during the concept interview, or when the user wants to change the game's look or upgrade asset generation (/forge:upgrade-assets).
---

# Art Direction

You run this conversation in the main session, because it needs the user.

## 1. Check the platform
```
node .forge/forge.mjs assess
```
Tell the user what this machine can make now (images, sfx, music, video) and what it can't. Mention any unfinished Stability Matrix downloads it lists.

## 2. Propose 3–4 art styles
If a style profile's art part was applied in the interview (`forge.yaml style_profile.art`), lead with that style: it already set `art.style`, `prompt_prefix`, `negative` and `palette`, and lists `suggested_checkpoints` (`forge style show <name>`). Only the checkpoint usually needs choosing on this machine.

Otherwise base them on `design/interview.md` (genre, tone, audience) and the story bible if it exists, for example: *painterly dark fantasy*, *clean anime visual novel*, *noir photographic*, *storybook watercolour*.

For each style, give:
- one line describing it
- a suggested `prompt_prefix` (style words)
- which **installed** checkpoint suits it, using the checkpoint list from `assess`, which includes each model's base and tags
- a quick sample where an installed model fits. Write a scratch prompt and run the draft workflow for a representative scene:
  ```
  node .forge/forge.mjs assets set bg:<some_bg_id> --prompt "<style words>, <scene>"
  node .forge/forge.mjs assets generate bg:<some_bg_id> --draft --count 2
  ```
  Show the images with the Read tool. Drafts are SDXL-Turbo, so they only *suggest* the style.

Use AskUserQuestion: one option per style, with the recommended one first.

## 3. Pick or install models
- If an installed checkpoint suits the chosen style, use it.
- Otherwise, search Civitai for checkpoints (or style LoRAs) that fit 8 GB of VRAM. SDXL, Illustrious and Pony bases all fit:
  ```
  node .forge/forge.mjs models search "<style keywords>" [--type LORA]
  ```
  Show 2–4 options with name, base, size, downloads and page link. Check each licence (commercial use) if the user plans to sell the game.
- **Install only after the user explicitly approves the specific model:**
  ```
  node .forge/forge.mjs models install-civitai <versionId> --yes
  ```
  This downloads into Stability Matrix's shared `Models\` folder and writes Stability Matrix's metadata sidecar. If Civitai needs a login for the file, the command prints the Stability Matrix Model Browser steps; relay them to the user.
- For the capability upgrades in `assess` (character consistency, upscaler, sfx, music, video), list each one with size, licence and what it unlocks. Ask which to install, then run `node .forge/forge.mjs models install <id> --yes` for each approved item. A node pack (IP-Adapter) needs `models node-pack <id> --yes` and a ComfyUI restart, which the user does in Stability Matrix.
- Gated models (Stable Audio Open) can't be downloaded by Forge. Give the user the printed instructions.
- Afterwards, run `node .forge/forge.mjs assess` again to confirm everything installed.

## 4. Record the choice
Edit `forge.yaml`, keeping the other keys:
```yaml
art:
  style: "painterly dark fantasy"
  checkpoint: "<file>.safetensors"
  prompt_prefix: "oil painting, dramatic chiaroscuro lighting, muted palette, <LoRA trigger words>"
  negative: "photo, 3d render, text, watermark, <avoided content>"
  defaults: {}            # e.g. bg: { workflow: sdxl-image-upscale } once upscaling is ready
```
Add the same summary under "Presentation" in `design/interview.md`. (`forge style save <name> --parts art` keeps it for future games.)

## Mid-project upgrades (/forge:upgrade-assets)
1. Run `assess`. It compares the new scan with the previous one and prints:
   - **now possible:** blocked assets that are now unblocked
   - **could be regenerated:** e.g. portraits made before IP-Adapter was available
2. Ask the user: generate the unblocked assets only, also regenerate selected ones, or defer. Approved assets are never replaced without a yes.
3. Brief the `asset-generator` agent with the choice. Then send the `assets` stage through its gate again and commit. The approval tag marks the upgrade.
