---
description: Create a new Story Forge game project and start the concept interview
argument-hint: <folder> [title]
---

Create a new Story Forge game project: $ARGUMENTS

1. Work out the target folder and title from the arguments. If either is missing, ask. Prefer a new folder next to the user's other projects.
2. Tell the user what creating a project does, and ask them to confirm:
   - writes `forge.yaml`, the pipeline state, and `forge/roles/<role>.md` playbooks (project-specific instructions the agents read)
   - installs the `yaml` npm package into the project
   - copies the asset pack (default `comfyui`: workflow library and model catalog into `forge/assets/`; nothing is downloaded). Use `--assets none` if the user doesn't want generated assets.
   - The game engine and its tools (story format, test browser) are **not** installed yet: the engine is chosen after the story bible (`/forge:engine`), and its downloads are approved then.
3. Once they confirm, run:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/forge.mjs" new "<folder>" --title "<title>"
   ```
   If git has no user identity configured, the initial commit fails. In that case ask the user to set `user.name` and `user.email`, then run `git commit` in the project.
4. Move the session into the new project folder if your environment supports it. Otherwise run all later commands from the project root.
5. Follow the `forge-orchestrator` skill. Start stage 1 using the `story-interview` skill.
