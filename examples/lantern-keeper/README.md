# Example: The Lantern Keeper

A tiny game used by the end-to-end test. It shows the files each stage produces (only the files the build and QA read are included):

- `design/branch-map.yaml`: the structure (story-planner)
- `characters/wren.yaml`: the structured character sheet (character-designer)
- `design/loops/loops.yaml`: one `stats` module owning `$wren_trust` (loop-designer)
- `script/*.script.md`: Forge Script (dialog-writer)

To try it, copy these folders into a project made with `forge new`, then run `node .forge/forge.mjs build` and `node .forge/forge.mjs qa functional`.
