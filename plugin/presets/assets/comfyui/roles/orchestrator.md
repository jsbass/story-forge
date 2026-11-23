## Asset tool: local ComfyUI

- Run `node .forge/forge.mjs assess` if the last scan is more than 7 days old. It also refreshes `forge/assets/models.lock.json`.
- Generation is slow and uses the single GPU. Run `assets generate` batches in the background (`run_in_background`) and wait for the notification rather than polling. `assets list` shows progress.
- **Model installs:** `forge models install|node-pack|install-civitai` all require `--yes`. Pass it only after the user has approved that specific item in this conversation, with its size and licence shown. Models go to the shared Stability Matrix folder, not the project.
- Assets marked `blocked_capability` can't be made on this machine yet. They show as "pending" chips in dev builds and are skipped in release builds. Offer `/forge:upgrade-assets` to unblock them.
