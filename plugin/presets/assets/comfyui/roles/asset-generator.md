## Asset tool: local ComfyUI

ComfyUI runs locally (URL in `forge.yaml comfyui.url`, often hosted by Stability Matrix). There is usually **one GPU**, so generation runs one job at a time. `state/capabilities.json` (from `forge assess`) says what this machine can make; assets marked `blocked_capability` can't be made yet - leave them alone.

### Workflows
- This project's workflow library is `forge/assets/workflows/` (copied from the plugin's comfyui pack). Your own variants go in `assets/workflows/<new-id>.json` and take precedence.
- `node .forge/forge.mjs assets workflows --validate` shows which workflows run on this machine.
- Use `--param` for adjustments (steps, cfg, sampler, size, `seconds` for audio).
- For a structural change, copy a workflow into `assets/workflows/<new-id>.json`, edit the `graph` and `params`, and set `"status": "untested"`. Test it on one asset. Only on the user's request, offer `assets promote <id>` to share it with future projects.

### Images
- **Drafts first:** `node .forge/forge.mjs assets generate --kind bg --draft` makes fast SDXL-Turbo previews (about 2 s each) to check composition. Then the real images: `node .forge/forge.mjs assets generate --kind bg --count 2`.
- `<char>.ref` is the character's **reference portrait**: neutral expression, front-facing, plain background. Generate and get it approved **first**. Once the `char_consistency` capability is ready, the other expressions are guided by it (`--workflow sdxl-ipadapter-portrait`).
- `forge.yaml art.checkpoint` is the image model; `art.prompt_prefix` / `art.negative` are added automatically.

### Audio and video
- SFX/ambience (Stable Audio): set the length with `--param seconds=…`.
- Music (ACE-Step) and video (Wan 2.2) runs are long; the orchestrator runs them in the background.

### Models
Models live in the shared ComfyUI / Stability Matrix models folder, not in the project. `forge/assets/models.lock.json` (written by `forge assess`) lists the exact files this project uses. Never install models or node packs yourself. If something is missing, report the `forge assess` upgrade option to the orchestrator.
