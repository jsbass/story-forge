# Loop: {{LOOP_ID}} ({{MODULE_TYPE}})

## Fantasy & theme
_What the player should feel; which story theme this loop expresses._

## Core loop
Action → feedback → reward. One short paragraph and a 3-step list.

## Variables owned
| var | meaning | min | max | init | visible |
|---|---|---|---|---|---|

## Effect on branches
_Which scenes read these variables and what thresholds open/close which choices (mirror branch-map gates)._

## Balance
_Typical gain/loss per scene, expected value at each act break, how many "good" choices are needed for each ending._

## Failure states
_What happens when a meter hits min/max. No soft-locks: every state must still reach some ending._

## UI
_What the player sees (sidebar meters, toasts, hidden?)._

## Script usage
```
<<stat "mara_aff" 2>>
* [Trust her] -> scene_05 {requires $mara_aff >= 5; else disabled}
```
