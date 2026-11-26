# Ship Workflow — Detailed Steps

## Step 1: Pre-flight

1. If the current branch is the target branch (main/master/dev): **ABORT**: "Ship from a feature branch, not the target branch."
2. Strip recognized flags (including `--both`), then normalize at most one positional mode token per "Ship Mode Detection" in `SKILL.md`:
   - If `--both` was stripped: load `dual-stage-workflow.md` and run the dual-target
     sequence — it supersedes any positional mode token (warn once when both appear).
   - Unclear branch name → `ask_user capability` with options: "Official (main)", "Beta (dev)"
   - Multiple mode tokens, an unknown non-flag token, or any unrecognized
     `--flag` left after stripping known flags → stop and ask; never silently
     choose a mode, ignore a typo, or reinterpret the token as a branch.
   - Aliases select the canonical mode only. `main` does not force a branch
     literally named `main`; `dev` does not force a branch literally named
     `dev`.
3. Auto-detect target branch:
   ```bash
   # For official: detect default branch
   git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'
   # Fallback
   git rev-parse --verify origin/main 2>/dev/null && echo "main" || echo "master"

   # For beta: detect dev branch
   for b in dev beta develop; do
     git rev-parse --verify origin/$b 2>/dev/null && echo "$b" && break
   done
   ```
4. Run `git status` (never use `-uall`). Record task ownership and intended ship scope; preserve unrelated uncommitted changes.
5. Read `git diff <target>...HEAD --stat` and `git log <target>..HEAD --oneline`.
6. If `--dry-run`: output what would happen at each step and stop here. Do not
   spawn `kongming`, activate `ak-review-pr`, publish social content, or perform
   any mutation.
7. If `--advice`, run the mandatory post-preflight Kongming checkpoint from
   `SKILL.md` before Step 2 or any mutation.

## Step 2: Link Issues

Collect related open issues (`gh issue list --search` on branch and commit
keywords) and `#N` references in `git log <target>..HEAD`. If none exist,
create one with `gh issue create` whose body covers: Problem Statement,
Proposal, How It Works (with an ASCII architecture diagram), Challenges,
Plan & Phases checklist, and Human Review Tasks. Keep the issue numbers for
Step 12.

## Step 3: Merge target branch

Fetch and merge so tests run against the merged state:

```bash
git fetch origin <target> && git merge origin/<target> --no-edit
```

Auto-resolve simple conflicts (lockfiles, version files). For complex
conflicts, **STOP** and show them.

## Step 4: Run Tests

**Skip if:** `--skip-tests` flag.

Run the test command from `auto-detect.md`. If none is detected, use
`ask_user capability`: "No test runner detected. Skip tests or provide command?"

On failure, classify the cause. Repair branch-caused failures within scope, then rerun affected checks. Preserve evidence and stop publication for unresolved external blockers or scope-changing decisions; never weaken tests.

## Step 5: Pre-Landing Review

**Skip if:** `--skip-review` flag.

1. Delegate `git diff origin/<target>` to a `code-reviewer` subagent for a two-pass review:
   - **Pass 1, critical:** security, injection, race conditions, auth bypass
   - **Pass 2, informational:** dead code, magic numbers, test gaps
2. For critical findings, verify the failure and repair in-scope defects. Ask only for a material missing decision or scope change; do not offer to bypass a real blocker. Record false positives with evidence.
3. After fixes, re-run affected tests (Step 4) before continuing.
4. Put informational findings in the PR body.
## Mandatory advice checkpoint after Steps 4-5

If `--advice`, run the mandatory post-tests/local-review Kongming checkpoint
before Step 6 or any versioning, changelog, commit, push, or PR write. This
checkpoint remains mandatory when `--skip-review` skips Step 5; pass the skip
reason together with test evidence. Record empty/error counsel and continue
only according to the authoritative ship gates.

## Step 6: Version Bump, then Steps 7-9 (changelog, journal, docs)

Load `release-and-social-workflow.md` and run Steps 6-9.

## Step 9b: Finalize plan (foreground, plan-backed ships only)

Run **synchronously before Step 10** so the finalized plan files are staged by
the ship commit. Full protocol: the "Delivery finalization (close on ship)"
section of the shared files-first plan-state reference
(`ak-cook/references/plan-state-files-first.md` (the `ak-cook` skill)).

1. `ak plan resolve` for the current repo + branch. **No active plan → skip this
   step silently** (most ships carry no plan).
2. Verify checkboxes with `ak plan status`; if the diff proves a phase done,
   `ak plan check <phase-file>` it. If the work is genuinely partial, `ak plan
   update <id> --status in-progress` and skip the completion below.
3. `ak plan update <id> --status completed` — rewrites `plan.md` front-matter
   `status:` (canonical) and the index in one op. Step 10's scoped staging then
   commits the finalized plan files with the ship, so `status: completed` reaches
   the target branch in the same merge as the code.

Do **not** run `ak plan close` here — that is the merge flow's job (the index
stays `active` through the review window). On any failure or missing `ak`, report
the plan-dir path + reason and continue the ship with a warning; never hand-edit
or delete plan files.

## Step 10: Commit

1. Stage only reviewed task-owned paths, including intended plan/version/docs artifacts: `git add -- <owned-paths>`. Inspect the staged diff against ship scope; do not absorb unrelated dirty files or existing staged work.
2. Scan the staged diff for secrets (API keys, tokens, passwords). If found: **STOP**, warn the user, suggest `.gitignore`.
3. Commit as `type(scope): description`, with version and changelog in the same commit.

## Step 11: Push

```bash
git push -u origin $(git branch --show-current)
```

- **Never force push.**
- If push rejected: suggest `git pull --rebase` and retry once.

## Step 12: Create PR

Without `gh`, report "Install GitHub CLI (gh) to auto-create PRs" and stop after push.

**Resolve writing language** before rendering the body:
```bash
WL_BIN=.claude/hooks/lib/writing-language.cjs
test -f "$WL_BIN" || WL_BIN=kits/core/hooks/lib/writing-language.cjs
node "$WL_BIN" --json
```
Load `references/pr-template.md` and the shared contracts of the `ak-review-pr` skill:
- `ak-review-pr/references/writing-language.md`
- `ak-review-pr/references/pr-body-contract.md`

Render the **seven required sections** plus Linked Issues / Ship Mode in the
effective language, with exact `Closes #N` / `Relates to #N` keywords for the
Step 2 issues. Keep the PR **title** English conventional-commit form.

Create with `gh pr create --base <target-branch>`, or `gh pr edit` when a PR
already exists for this branch (same contract). Validate before finishing:
```bash
PR_BIN=.claude/hooks/lib/pr-body-contract.cjs
test -f "$PR_BIN" || PR_BIN=kits/core/hooks/lib/pr-body-contract.cjs
gh pr view --json body -q .body | node "$PR_BIN"
```

**Output the PR URL** — this is the final output the user sees.

In a batch-landing repository (see "Batch-landing repositories" in the skill),
include the local verification evidence its instructions name in the body and
create the PR ready for review; after Step 12b, stop.

## Step 12b: Record plan↔PR linkage (plan-backed ships only)

If Step 9b finalized a plan, record the PR number on it so the merge flow can
match plan to PR and close the index unambiguously:
```bash
ak plan update <plan-id> --linked-pr <pr-number>
```
`--linked-pr` is index-only (it does not touch files). Skip silently when no
plan was finalized. Do not close the plan here — the index `close` happens only
after the PR merges (see the shared reference's "Delivery finalization" section).

## Step 13: Review, fix, reply, and merge (if `--merge`)

Load `review-and-merge-workflow.md` and run Step 13.

## Step 14: Social publish (if `--social`)

Load `release-and-social-workflow.md`. When `--merge` is present, run Step 14
only after the Step 13 terminal-state gate allows it. Without `--merge`, Step 13
is skipped and the existing Step 14 green-PR-check gate decides eligibility.
