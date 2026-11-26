# Fix loop mode (`--fix`)

If `$ARGUMENTS` contains `--fix`, follow this loop after the review steps above, **per PR**:

## 1. Decide whether fixing is needed

- If no actionable findings, stop and report **Approve** for this PR.
- Actionable = all **Critical** + **Important** findings, plus **Suggestion** findings that are concrete, low-risk, and tied to PR scope.
- Do not invent new style-only suggestions to keep the loop running.

## 2. Fix all findings

Activate `ak-fix --auto` with the full findings list and PR context:

```
ak-fix --auto "Fix all actionable findings from review-pr <PR_REF>: <finding summary>"
```

Pass the PR reference, base and head branches, changed files, and each finding's
severity, location, expected versus actual behavior and impact. Constrain it to PR scope:
no unrelated refactors, and public contracts stay backward compatible unless the finding
requires a contract change. `ak-fix` runs its own scout, diagnose, verify flow; do not
bypass its hard gates.

## 3. Commit and push

After `ak-fix` verifies the fixes, activate:

```
ak-git cp
```

This stages, commits, and pushes the fixes to the PR head branch. Do not run `ak-git cp` if verification failed, secrets are detected, or the working tree contains unrelated user changes.

## 4. Re-review

After the push succeeds, activate `review-pr <PR_REF> --fix` again (carrying `--reply`, `--merge`, and `--advice` forward if they were originally set) and repeat the loop **for this PR only**. Do not advance to the next PR ref while the current fix loop is unresolved.

With `--advice`, run the "loop is stuck" checkpoint from Advisory supervision before declaring a stop condition.

Stop only when one of:
- the re-review finds no actionable findings
- `ak-fix` is blocked by a missing user/business decision
- the same finding survives 3 consecutive fix attempts (loop not converging)
- CI or local verification fails in a way `ak-fix` cannot resolve without user input

Report iterations, commits and remaining findings in the Final output table.
