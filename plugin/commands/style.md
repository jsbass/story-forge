---
description: Manage shared style profiles (prose, art, UI theme, audio) - list, show, apply to this game, or save this game's style
argument-hint: [list | show <name> | apply <name> [parts] | save <name>]
---

Style profiles: $ARGUMENTS (default: list)

- **list:** run `node .forge/forge.mjs style list` and show each profile in one line (built-in examples and the user's library in `~/.forge/styles/`).
- **show <name>:** `node .forge/forge.mjs style show <name>`; summarise each part (prose rules, art prompt words and palette, UI look, audio mood) rather than dumping the files.
- **apply <name> [parts]:** confirm which parts (prose, art, ui, audio; default all) and that it will overwrite `design/style/prose.md`, `design/style/audio.yaml`, `src/custom/style.css` and the `art` keys in `forge.yaml`. Then run `node .forge/forge.mjs style apply <name> --parts <parts>`. Combining profiles = applying different parts from each.
  - Mid-project, applying prose or art affects existing scripts/assets: run `node .forge/forge.mjs impact design/style/ forge.yaml` and ask whether to regenerate anything (dialog-writer for prose, asset-generator for art/audio). UI applies at the next build.
- **save <name>:** ask for a one-line description and which parts; then `node .forge/forge.mjs style save <name> --description "..." [--parts ...]`. If the name exists, ask before passing `--force`.
