---
description: Run Twine Forge QA (functional + character consistency) on the latest build
argument-hint: [functional|character|all]
---

Run QA: $ARGUMENTS (default: all)

1. Rebuild first with `node .forge/forge.mjs build`, so QA checks the current scripts.
2. Run the requested agents. For `all`, run `qa-functional` and `qa-character` **in parallel**.
3. Combine their findings using the *QA fix loop* in the `forge-orchestrator` skill:
   - list any S3/S4 auto-fixes that were applied, with their commits
   - present each S1/S2 finding with the proposed fix and its feedback id
   - give PASS or FAIL
4. If the `qa` stage is in progress and nothing at S1/S2 is open, submit it and present the gate.
