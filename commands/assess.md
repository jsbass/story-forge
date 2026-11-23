---
description: Scan this machine's GPU and ComfyUI models and show what assets it can generate
---

Run `node "${CLAUDE_PLUGIN_ROOT}/tools/forge.mjs" assess` (or `node .forge/forge.mjs assess` inside a project) and summarise it for the user:
- the hardware and ComfyUI status
- which capabilities are ready, missing, or need a node pack
- unfinished Stability Matrix downloads to finish or delete
- the upgrade options, each with size, licence and what it unlocks

Don't install anything. If the user wants upgrades, follow the `art-direction` skill (section 3). Each install needs their explicit approval.
