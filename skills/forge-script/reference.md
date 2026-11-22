# Forge Script reference

Forge Script is the dialog format the Dialog Writer uses. Files live in `script/` with the extension `.script.md`, typically one act or chapter per file. Name them so they sort in story order (`01-arrival.script.md`). The Builder compiles them into SugarCube 2 Twee with a deterministic compiler, so the same script always produces the same game.

## Structure

```
# SCENE scene_07 — The Flooded Hold [chapter2 tense]
...scene body...

## lie — A Lie
...sub-passage body (passage name: scene_07.lie)...
```

| Line | Meaning |
|---|---|
| `# SCENE <id> — <Title> [tags]` | Starts a scene, which becomes a passage named `<id>`. The title and tags are optional. Ids start with a letter and may contain letters, digits, `_` and `-`. |
| `## <id> — <Title> [tags]` | Starts a sub-passage of the current scene, named `<scene>.<id>`. |
| `// comment` | Ignored. |

## Body lines

| Syntax | Meaning | Compiles to |
|---|---|---|
| Plain text | Narration. Consecutive lines join into one paragraph, and a blank line starts a new one. SugarCube markup (`''bold''`, `//italic//`, `$var`) works. | `<p>…</p>` |
| `MARA: text` | A spoken line. The speaker is written in UPPERCASE and maps to `characters/mara.yaml` (spaces become `_`, so `OLD SAILOR` maps to `old_sailor`). | `<<forge_say "mara">>text<</forge_say>>` |
| `MARA (quiet): text` | A spoken line with a parenthetical delivery note. | `<<forge_say "mara" "quiet">>…` |
| `@bg id` `@music id` `@ambience id` `@sfx id` `@video id` `@voice id` | Media cues. Several can go on one line. | `<<forge_media "bg" "id">>` |
| `@portrait mara worried` | A character portrait with an expression. | `<<forge_media "portrait" "mara" "worried">>` |
| `> set $trust += 1; set $met_mara = true` | State changes (the `set` keyword is optional). | `<<set …>>` |
| `?? if <expr>` / `?? elseif <expr>` / `?? else` / `?? end` | Conditional block. Expressions are SugarCube/JS (`$a >= 3 && !$b`). | `<<if>>…<</if>>` |
| `* [Label] -> target {mods}` | A choice. Consecutive choices are grouped into one choice list. | `<<link "Label" "target">>` |
| `-> target [Label]` | A single "Continue" link (the label defaults to *Continue*). | link |
| `END <id> "Title"` or `END <id> — Title` | Marks the passage as an ending (it gets the `ending` tag and an ending screen). | `<<forge_ending "id" "Title">>` |
| `<<macro …>>` | A raw SugarCube line, for loop-module widgets like `<<stat "mara_aff" 2>>`. | as written |

### Choice targets
- `scene_08` refers to a scene (or a full sub-passage name like `scene_08.dock`).
- `.lie` refers to a sub-passage of the **current** scene (`scene_07.lie`).

### Choice modifiers `{…}`
Separate modifiers with `;`.

| Modifier | Effect |
|---|---|
| `set $x += 2` | Runs when the choice is clicked. Can be repeated. |
| `requires <expr>` | The choice only appears or works when `<expr>` is true. |
| `else hidden` (default) / `else disabled` | When the requirement fails, either hide the choice or show it greyed out. |
| `do <<macro>>` | Runs a raw macro when clicked, e.g. `do <<stat "mara_aff" 1>>`. |

## Rules that the compiler and QA enforce
- Every choice target must exist (in any script file, or in `src/custom/*.twee`).
- Every speaker must have a `characters/<id>.yaml` sheet (once any sheets exist).
- Every `?? if` needs a matching `?? end` in the same passage.
- Every passage needs a way forward (a choice or `->`) or an `END`. Otherwise QA reports a dead end.
- Every variable that is read must be set somewhere or declared (in a loop module, character `affinity_var`, branch-map `variables`, or `forge.yaml vars`).
- Every ending listed in `design/branch-map.yaml` must have an `END` with the same id.

## Complete example

```
# SCENE scene_07 — The Flooded Hold
@bg hold_flooded   @music tension_low   @ambience drip_loop
@portrait mara worried

Water slaps against the crates. Somewhere above, a rope creaks.

MARA: Right then. Water's at the second rung.
MARA (quiet): You didn't see the Captain's log. Did you?

?? if $lied_to_mara
MARA: And don't lie to me twice.
?? end

* [Tell her the truth] -> scene_08 {do <<stat "mara_aff" 2>>}
* [Lie] -> .lie {set $lied_to_mara = true}
* [Use the rope] -> .rope {requires $has_rope; else disabled}

## lie
MARA: Hm. Fine.
<<stat "mara_aff" -1>>
-> scene_08

## rope — Over the Side
The rope holds. Barely.
END drowned "Lost to the Deep"
```
