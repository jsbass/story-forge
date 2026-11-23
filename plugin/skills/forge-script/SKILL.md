---
name: forge-script
description: Reference for Forge Script, the branching-dialog format (*.script.md) that Twine Forge compiles for the project's engine. Use when writing, editing, reviewing or debugging files in a Forge project's script/ folder, or when a build reports a script error.
---

# Forge Script

Read `reference.md` in this skill folder for the full syntax. A copy can also be printed from inside a project with `node .forge/forge.mjs template forge-script`. The engine-specific parts (inline markup, expression syntax, loop-module macros such as `<<stat>>` below) are in the project's `forge/roles/dialog-writer.md`.

The essentials:

```
# SCENE scene_07 — The Flooded Hold
@bg hold_flooded   @music tension_low
Narration paragraph.
MARA (quiet): Spoken line.
> set $visited_hold = true
?? if $mara_aff >= 5
MARA: I trust you.
?? end
* [Tell her the truth] -> scene_08 {do <<stat "mara_aff" 2>>}
* [Use the rope] -> .rope {requires $has_rope; else disabled}

## rope
END drowned "Lost to the Deep"
```

Validate after every edit:

```
node .forge/forge.mjs compile
```

The compiler reports `file:line  message`. Fix every error before submitting the script stage.
