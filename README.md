# Story Forge

This repository has two areas:

| Folder | What it is |
|---|---|
| [`plugin/`](plugin/README.md) | The Claude Code plugin: generic agents, skills and commands, the `forge` CLI, and copyable preset packs (`plugin/presets/`) for the SugarCube engine and the ComfyUI asset tool. It holds no game content and no engine or build dependencies. |
| `example/` | An example game project (The Lantern Keeper) created with the plugin, used to test it end to end. It is its own git repository (stage approvals commit and tag inside it), so the outer repo ignores it. |

Install the plugin from `plugin/` (or add this repo as a marketplace; see `.claude-plugin/marketplace.json`). Plugin tests: `cd plugin && npm test`.

To recreate the example project from scratch, see "Example project" in [plugin/README.md](plugin/README.md#develop).
