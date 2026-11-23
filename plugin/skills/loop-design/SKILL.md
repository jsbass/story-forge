---
name: loop-design
description: Runs the Story Forge game-loop design conversation with the user (stage 4, or /forge:add-loop mid-project), then hands the decisions to the loop-designer agent. Use when choosing, adding, rebalancing or removing gameplay loops in a Forge project.
---

# Loop design conversation

Loops are modules that can be added, tuned or removed at any time. Your job is to get the user's intent; the `loop-designer` agent turns it into `design/loops/`.

## 1. Prepare
- Read the loop section of `design/interview.md`, then `design/story-bible.md` (themes) and `design/branch-map.yaml` (gates and endings).
- `node .forge/forge.mjs loops` shows what's already active.

## 2. Ask the user (2–3 rounds at most)
- **Fantasy:** what should the loop make the player feel? Tie it to a theme from the bible. Offer 2–3 concrete loop ideas that fit, for example: "Trust meters with each crewmate: the theme is earned loyalty, and high trust opens the mutiny ending."
- **Visibility:** visible meters, hidden values, or vague hints ("Mara seems warmer")?
- **Stakes:** which endings or branches should depend on it, and how hard should the good outcomes be to reach?
- **Scope:** how many meters or items there should be. Recommend 2–3 for a short game.

Module types available (`node .forge/forge.mjs loops types`):
- `stats`: clamped numeric meters with a sidebar and toasts (relationships, reputation, resources)
- `inventory`: items, capacity, combine recipes, item-gated choices (puzzles)
- `minigame`: dice skill checks against a stat, code locks with limited attempts
- `explore`: hub-and-spoke map with travel costs and an optional time budget/deadline

Offer combinations when they serve the theme ("the island map costs daylight; the cave needs the grappling line you build from what you find"). If the user wants something none of these do (real-time timers, card battles, a bespoke puzzle), record it as a `needs-module` design: the game-builder implements it as custom code, and it can become a reusable module later. Mention to the user that real-time or physics-heavy ideas fit a browser text engine poorly; the `engine-advisor` will flag them.

## 3. Delegate
Brief the `loop-designer` agent with:
- the user's answers, quoted where you can
- which themes and endings the loop connects to
- for mid-project additions: "this is an add-loop; produce an Integration plan and run impact analysis"

## 4. Mid-project additions (/forge:add-loop)
1. Present the loop-designer's integration plan and the output of `forge impact design/loops/`.
2. Ask whether to proceed with regenerating the affected scripts.
3. Once the user approves, put the `loops` stage through its gate again, then brief the `dialog-writer` with the scene list from the integration plan, then rebuild and re-run QA.
