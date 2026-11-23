## Engine: SugarCube 2 - loop modules

`node .forge/forge.mjs loops types` lists the module types installed in this project. Each `forge/engine/modules/<type>/module.mjs` header has the full parameter reference and an example.

| type | What it does | Script usage |
|---|---|---|
| `stats` | Named numeric meters (relationships, reputation, resources). Clamped to min/max, shown in the sidebar, toasts on change. | `<<stat "var" delta>>`; conditions like `$var >= 5` |
| `inventory` | Items the player carries (optional `capacity`, `start` items), combine `recipes`. Sidebar list with "Combine" buttons. | `<<give "id">>` `<<take "id">>` `<<combine "a" "b">>`; conditions `$inv.includes("id")` |
| `minigame` | Turn-based challenges that end in a success or failure passage: dice `skill_check`s against a stat, and code `locks` with limited attempts. | `<<skill_check "label" "statVar" dc "success" "failure">>`, `<<codelock "lockId" "success" "failure">>` |
| `explore` | Hub-and-spoke `locations` with travel costs (`requires` conditions, locked text, visited marks) and an optional `time` budget with an `expire` passage. | `<<map_menu>>` in the hub scene, `<<spend n>>`; conditions `$hours > 2` |

Several modules combine well (e.g. `explore` + `inventory` locks a location until an item is found; `minigame` checks read a `stats` meter). The build checks module usage: unknown items, locks, missing location passages and malformed macros are build errors.

If the design needs something these can't do (real-time timers, card battles, a custom puzzle), mark the doc `status: needs-module`; the game-builder writes it as custom SugarCube code in `src/custom/`. Don't invent a `type` in `loops.yaml`, because the build will fail.

### QA-friendliness
Automated playthroughs click links. Minigames and the map expose `[QA]` outcome links in QA runs, but gates that need several steps in a row (find item A, then B, then combine, within a time budget) are rarely hit by random walks: say in the doc which walk count QA should use (e.g. `--walks 200`) or keep chains short.
