# Implementation steps

Capture or reuse the opening contract and select the mode in SKILL.md. Reuse fresh
evidence instead of rerunning an earlier owner. Create a concise plan or phase files
according to coordination/risk. Only explicit `--interactive` pauses after research,
plan, implementation and tests.

## Implement

Reconcile the accepted plan with current source before edits. Keep phase dependencies
and ownership; track state through available capabilities or the plan files.

### `--tdd` Flag Behavior

Per phase: write tests for current behavior first, then implement, then verify those
tests and compile gates still pass. A test from the first step that fails afterwards
means the change broke behavior; fix it before the workflow proceeds.

Under `--advice`, a broken characterization test here is an objective `kongming`
trigger: spawn `kongming` with the command, its output, and what you tried before
re-fixing.

### Conditional Simplify (live-diff gated)

Recompute signals from the live worktree (no hook state):

```bash
totals=$(git diff --numstat HEAD --ignore-all-space)
loc=$(echo "$totals" | awk '{s+=$1+$2} END {print s+0}')
files=$(echo "$totals" | awk 'NF{c++} END {print c+0}')
maxFile=$(echo "$totals" | awk 'BEGIN{m=0} {if ($1>m) m=$1} END {print m+0}')
modified=$(git diff --name-only HEAD)
```

Read thresholds from the `simplify` section of `ak config prefs resolve --json`
(`simplify.threshold.{locDelta,fileCount,singleFileLoc}`), defaulting to 400 / 8 / 200.
If any threshold is breached, spawn the simplifier scoped to the modified files:

```
delegate_agent capability(subagent_type="code-simplifier", prompt="Simplify these files while preserving behavior exactly: [file-list]", description="Simplify recent edits")
```

Afterwards, log only (never re-run or block): "simplifier made scoped edits" when
`git diff --shortstat HEAD -- [file-list]` changed, otherwise "simplifier ran clean".
Skip the step when `CK_SIMPLIFY_DISABLED=1` or `simplify.gate.enabled` is `false`.

## Verify and review

Run the narrowest useful test, then affected caller, type, lint or build checks according to
risk. For type/lint-only repairs the compiler/linter can provide sufficient regression evidence.
Use `review-cycle.md` and `required-subagents.md` for review and delegation scope.

## Finalize

Reconcile completed work against all affected existing plan phases, preserving unchecked
items that lack evidence. Use `plan-state-files-first.md`; runtime tracking is optional.
Assess docs impact and update the smallest owning surface. Report outcome, verification,
remaining work and setup requirements. Commit only when already authorized; finalization
does not itself authorize a commit or publication. Apply the journal preference contract
in SKILL.md, reusing a preference resolved earlier in this run. Continue the next
authorized phase unless explicit interactive review or a real blocker stops it.
