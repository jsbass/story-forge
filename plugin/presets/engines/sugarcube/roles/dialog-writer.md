## Engine: SugarCube 2

- Forge Script compiles to SugarCube 2 Twee. Inside narration and dialog, SugarCube markup works: `''bold''`, `//italic//`, `$var` prints a variable.
- `?? if` expressions and `requires` modifiers are SugarCube/JavaScript expressions: `$trust >= 3 && !$lied`, `$inv.includes("rope")`.
- Loop hooks are raw SugarCube macro lines or `do <<…>>` choice modifiers. The macros come from this project's loop modules (`node .forge/forge.mjs loops types`):
  - stats: `<<stat "mara_aff" 2>>`
  - inventory: `<<give "rope">>`, `<<take "rope">>`, `<<combine "rope" "hook">>`
  - minigame: `<<skill_check "Climb" "grit" 12 "top" "fall">>`, `<<codelock "vault" "inside" "alarm">>`
  - explore: `<<map_menu>>` (in the hub scene), `<<spend 1>>`
- Macros that navigate count as a way forward for QA: `<<map_menu>>` (every location and the time-out passage), `<<skill_check>>` and `<<codelock>>` (their success and failure passages).
- Module arguments must exist: item ids, lock ids, and the passages named in `explore` locations. `compile`/`build` fail otherwise.
