---
description: Create a new Twine Forge game project and start the concept interview
argument-hint: <folder> [title]
---

Create a new Twine Forge game project: $ARGUMENTS

1. Work out the target folder and title from the arguments. If either is missing, ask. Prefer a new folder next to the user's other projects.
2. Tell the user that creating a project installs these into the project folder, and ask them to confirm:
   - `yaml` and `playwright` from npm
   - Playwright's Chromium browser (about 150 MB, cached per user)
   - the SugarCube 2 story format, downloaded from the official `tmedwards/sugarcube-2` GitHub release
3. Once they confirm, run:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/forge.mjs" new "<folder>" --title "<title>"
   ```
   If git has no user identity configured, the initial commit fails. In that case ask the user to set `user.name` and `user.email`, then run `git commit` in the project.
4. Move the session into the new project folder if your environment supports it. Otherwise run all later commands from the project root.
5. Follow the `forge-orchestrator` skill. Start stage 1 using the `story-interview` skill.
