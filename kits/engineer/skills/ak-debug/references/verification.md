# Verification Before Completion

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you have not run the verification command in this message, you cannot claim it passes.
This applies to any wording that implies success, and before committing, opening a PR,
completing a task or delegating.

## The Gate

1. Identify the command that proves the claim.
2. Run the full command fresh.
3. Read the full output, the exit code and the failure count.
4. If the output confirms the claim, state it with the evidence; otherwise state the actual
   status with the evidence.

## What Counts as Evidence

| Claim | Requires | Not sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing, logs look good |
| Bug fixed | Original symptom retested: passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle: pass, revert fix and see it fail, restore and pass | Test passes once |
| Agent completed | VCS diff shows the changes | Agent reports "success" |
| Requirements met | Plan re-read, line-by-line checklist | Tests passing |
