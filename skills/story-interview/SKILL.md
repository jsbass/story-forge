---
name: story-interview
description: Runs the Twine Forge concept interview with the user (stage 1) and records it in design/interview.md. Use at the start of a new Forge project (/forge:new) or when the user wants to rework the core concept.
---

# Concept interview

You interview the user directly; don't delegate this to a subagent. The goal is a concept specific enough that the Story Planner can design the whole structure without guessing.

## Setup
- `node .forge/forge.mjs stage start interview`
- Print the template with `node .forge/forge.mjs template interview.md`. Copy it to `design/interview.md` and fill it in as you go.

## How to interview
- Ask **2–4 questions at a time**, using the AskUserQuestion tool where it's available. Offer concrete options plus "Other". Make your recommended option the first one.
- Adapt the questions. Skip anything the user already answered, and dig deeper where their answers are vague ("dark fantasy" → what kind of dark? grim and violent, melancholy, or horror?).
- Reflect back what you heard every round or two, in one or two sentences.
- Keep it to about 4–6 rounds. Park anything that can wait under "Open questions".

## Topics, roughly in this order
1. **Pitch:** the premise in the user's own words, and inspirations.
2. **Audience and rating:** who it's for, the target rating (E/T/M or similar), and themes to avoid. These go into `forge.yaml rating`.
3. **Shape:** the size (short / medium / long, written to `forge.yaml size`), the number of endings, the branching style, and the perspective.
4. **World and tone:** genre, three tone adjectives, the setting, and the themes to explore.
5. **Characters:** who the user already imagines. Sketches are fine, because the Character Designer develops them later.
6. **Game loops:** which loops they want (stats/relationships, inventory and puzzles, minigames, exploration/time, or something else) and what each should make the player feel. Say that loops can be added later with `/forge:add-loop`.
7. **Presentation:** audio mood, voice-over on or off (written to `forge.yaml voice_over`), and the distribution targets.
   **Style profile:** run `node .forge/forge.mjs style list` and offer the profiles (built-in examples plus the user's own library), each in one line. The user can take one whole, mix parts from several (e.g. prose from one, UI from another), or start fresh. Apply with `node .forge/forge.mjs style apply <name> [--parts prose,ui]`; it writes `design/style/prose.md`, `design/style/audio.yaml`, `src/custom/style.css` and the `forge.yaml art` keys. A profile's art part feeds step 8 as the starting point, so confirm or adjust it there rather than asking twice.
8. **Art direction:** run the `art-direction` skill. It checks the platform, proposes styles with quick samples, picks or installs models (only with the user's approval), and records `forge.yaml art`.

## Finish
1. Write `design/interview.md` with every section filled in or marked "n/a", using the user's own phrasing where you can.
2. Update `forge.yaml`: `size`, `rating.target`, `rating.avoid`, `voice_over` and `art`. Edit the existing keys rather than rewriting the file.
3. `node .forge/forge.mjs stage submit interview`
4. Run the gate: summarise the concept in about 8 lines and ask the user to approve it or request changes.
5. Later, when the user likes how the game turned out, offer to save its style for future games: `node .forge/forge.mjs style save <name> --description "..."` (saves to `~/.forge/styles/`).
