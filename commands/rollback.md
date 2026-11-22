---
description: Roll a Twine Forge stage back to a previously approved version
argument-hint: <stage> [version]
---

Roll back: $ARGUMENTS

1. Run `git tag --list "stage/*"` to list the approved versions, and pick the tag (`stage/<stage>/v<N>`). If the version isn't given, show the available versions with their dates and ask which one.
2. Show what will be restored: `git diff --stat <tag> -- <stage artifacts>`. Ask the user to confirm.
3. Run `node .forge/forge.mjs rollback <tag>`. Then put that stage through its gate again. Later stages are now stale; show them with `node .forge/forge.mjs status`.
