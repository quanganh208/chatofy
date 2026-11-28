## Advisory supervision (`--advice`)

When `--advice` is present, run this skill under `kongming` supervision.
Load `../../ak-brainstorm/references/advisory-supervision.md` for supervisor
identity, host detection, and model routing.

Spawn `kongming` at these checkpoints (**per PR**, not once per run):

- **After the initial review completes**: pass the PR reference, diff summary,
  findings with severities and the tentative verdict; ask for a go/no-go on the
  verdict, missed findings and, with `--fix`, which findings are worth fixing
  versus over-reach.
- **When the `--fix` loop is stuck** (same finding survives 3 attempts, `ak-fix`
  is blocked, or CI keeps failing for the same reason): pass every approach
  tried and the exact failure; ask for a new angle or a legitimate stop
  condition.
- **Before posting `--reply`**: pass the final review body and ask for a check of
  tone, evidence and severities. Revise the body for any Critical/Important
  issue it flags; counsel is not a veto on the verdict itself.
- **Before triggering `--merge`**: pass the merge-readiness evidence (verdict,
  `reviewDecision`, `mergeable`, CI status, blockers) for a risk sanity check.
  The merge-readiness gate in Merge mode stays authoritative.
- **Once per PR, after the PR is open and CI is terminal-green**: have
  `kongming` review the whole implementation (diff, PR body, linked issue when
  one exists), then post its assessment and concrete next steps as a PR comment
  via `_ak_pr_comment "$OWNER" "$REPO" "$NUMBER"` (see GitHub API
  compatibility), with the `--reply` traceability footer. It does not run per
  fix-loop iteration. With `--merge`, it fires inside Merge mode step 2. Without
  `--merge`, fire it at the end of the PR's iteration if `_ak_pr_checks` is
  terminal-green; otherwise skip it and give the reason (CI red, pending, or
  unavailable) in the Final output.

**Empty-counsel fallback**: if `kongming` returns nothing, errors, or is
unreachable, record that in chat and continue the review/fix/reply/merge flow;
a missing advisory step never fails the skill.

**Forward-carry in the fix loop**: the `--fix` re-invocation carries `--advice`
forward alongside `--reply` and `--merge` so supervision persists across
iterations.

`--advice` adds supervision; it never bypasses this skill's approval gates,
tests, code-review blockers, branch protections, or security policy, and
counsel never overrides the review verdict.

## Ultra Verifier Mode (`--ultra`)

When `--ultra` is present, run the **initial review of each PR** as a best-of-5
verifier pass. The controller assembles one immutable evidence packet per PR
(diff, PR body, linked issue, CI status, review rubric), dispatches exactly
five independent read-only candidate reviews in one parallel wave, then a
single strongest-model verifier validates the findings.

- **Candidate task:** each candidate performs the full review of the same PR
  evidence packet and returns its findings list with severities and cited
  evidence. Candidates never comment, commit, or call `gh` mutations.
- **Finalizer:** the verifier returns the evidence-validated, deduplicated union
  of findings across the five reviews and never selects one review wholesale,
  because a real defect may appear in only one candidate. It drops findings it
  cannot validate against cited evidence and merges duplicates; ranking orders
  severity and confidence only.
- The fix/reply/merge flow then runs once on that union; re-reviews in the
  fix loop stay single-pass. Multi-PR mode fans per PR, still sequentially
  across PRs.

Full mechanics are in `../../ak-brainstorm/references/ultra-verifier-mode.md`.
It is a best-of-5 verifier mode inspired by LLM-as-a-Verifier, not the full
framework.
