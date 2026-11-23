---
description: Upgrade asset generation mid-project (install approved models, then unblock or regenerate assets)
---

Follow the `art-direction` skill: section 3 (installing models, with the user's explicit approval for each one), then *Mid-project upgrades*.

1. `node .forge/forge.mjs assess`. Show the capabilities and the upgrade options.
2. Ask which upgrades to install. Install only the approved ones (`models install <id> --yes`, and `models node-pack <id> --yes` where needed).
3. `node .forge/forge.mjs assess` again. Show what's now possible and what could be regenerated.
4. Ask whether to generate the unblocked assets only, also regenerate selected ones, or defer. Brief the `asset-generator` accordingly, then send the `assets` stage through its gate again.
