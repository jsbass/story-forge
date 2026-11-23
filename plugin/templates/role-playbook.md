# {{title}} - project playbook

The `{{role}}` role reads this file before it starts work. It holds the parts of the job that are specific to this project:

- **Pack sections** (between `forge-pack` markers) are copied in from the plugin's preset packs by `forge pack install` / `forge engine set`. They describe the tools this project uses (engine, asset generator). You can edit them. `forge pack install <id> --force` replaces a section with the plugin's version, and `forge pack remove <id>` deletes it.
- **Project notes** (below, outside the markers) are yours. Add conventions, decisions and lessons the {{role}} should follow in this game. Pack updates never touch them.

Where this playbook is more specific than the plugin's generic instructions, follow the playbook.

## Project notes

(none yet)
