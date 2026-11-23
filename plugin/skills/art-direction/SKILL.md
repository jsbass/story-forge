---
name: art-direction
description: Runs the Twine Forge Art Direction step with the user - choose an art style, see quick samples, pick or install suitable models for the project's asset tool, and record the result in forge.yaml art. Use during the concept interview, or when the user wants to change the game's look or upgrade asset generation (/forge:upgrade-assets).
---

# Art Direction

You run this conversation in the main session, because it needs the user.

**Project playbook:** read `forge/roles/art-direction.md` first. Its asset-tool section (from the project's asset pack) gives the commands for checking this machine, making samples, searching for and installing models, and the tool-specific `forge.yaml` keys. Follow it for every step marked *(playbook)* below. If the project has no asset pack, skip samples and models and record only the style.

## 1. Check the platform *(playbook)*
Tell the user what this machine can make now (images, sfx, music, video) and what it can't.

## 2. Propose 3–4 art styles
If a style profile's art part was applied in the interview (`forge.yaml style_profile.art`), lead with that style: it already set `art.style`, `prompt_prefix`, `negative` and `palette`, and lists `suggested_checkpoints` (`forge style show <name>`). Only the model usually needs choosing on this machine.

Otherwise base them on `design/interview.md` (genre, tone, audience) and the story bible if it exists, for example: *painterly dark fantasy*, *clean anime visual novel*, *noir photographic*, *storybook watercolour*.

For each style, give:
- one line describing it
- a suggested `prompt_prefix` (style words)
- which installed model suits it *(playbook)*
- a quick sample where an installed model fits *(playbook)*. Show the images with the Read tool.

Use AskUserQuestion: one option per style, with the recommended one first.

## 3. Pick or install models *(playbook)*
- Prefer a model that is already installed.
- Show 2–4 options with name, size, licence and a link. Check each licence (commercial use) if the user plans to sell the game.
- **Install only after the user explicitly approves the specific model or upgrade.** Commands that download need `--yes`; pass it only after that approval.
- Re-check the platform afterwards.

## 4. Record the choice
Edit `forge.yaml`, keeping the other keys:
```yaml
art:
  style: "painterly dark fantasy"
  checkpoint: "<model file>"
  prompt_prefix: "oil painting, dramatic chiaroscuro lighting, muted palette, <LoRA trigger words>"
  negative: "photo, 3d render, text, watermark, <avoided content>"
  defaults: {}            # per-kind workflow overrides (playbook)
```
Add the same summary under "Presentation" in `design/interview.md`. (`forge style save <name> --parts art` keeps it for future games.) Note anything project-specific you learned (e.g. "this model needs cfg 4") in the playbook's project notes.

## Mid-project upgrades (/forge:upgrade-assets)
1. Re-check the platform *(playbook)*. It reports blocked assets that are now possible, and approved assets that could be regenerated at higher quality.
2. Ask the user: generate the unblocked assets only, also regenerate selected ones, or defer. Approved assets are never replaced without a yes.
3. Brief the `asset-generator` agent with the choice. Then send the `assets` stage through its gate again and commit. The approval tag marks the upgrade.
