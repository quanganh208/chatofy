---
name: ak-vibe
description: "Run the vibe pipeline to PR readiness: worktree, plan, cook/fix, code-review, ship, review-pr; --both ships beta then stable, --ultra verifies, --advice uses kongming."
when_to_use: "Invoke to take a GitHub issue or request through shipping, merge and CI convergence."
category: workflow
keywords: [vibe, pipeline, autonomous, ship, worktree, plan, cook, fix, review-pr, ci, advice, kongming, ultra, debug, research, test, docs]
argument-hint: "[--ship] [--beta] [--both] [--advice] [--ultra] <github-issue-url | feature request>"
license: Proprietary
metadata:
  author: agentkit
  version: "1.5.1"
---

# Vibe Pipeline

Run a full autonomous product-development pipeline from request intake to PR
readiness, with optional merge and post-merge CI convergence.

This skill orchestrates `/ak-worktree`, `/ak-plan`, `/ak-cook`, `/ak-fix`,
`/ak-code-review`, `/ak-ship`, and `/ak-review-pr`, adding `/ak-debug`,
`/ak-research`, `/ak-test`, and `/ak-docs` when their triggers hold. It does
NOT bypass those skills' approval gates, tests, code-review blockers, branch
protections, or security policies.

## Inputs

| Flag | Effect |
| --- | --- |
| `--beta` | Ship to beta/dev target via `/ak-ship beta`; final ready label is `ready to ship beta`. |
| `--ship` | After review/fix/reply, merge the PR and watch/fix CI until success or true external blocker. |
| `--both` | Dual-stage ship: run the full beta stage first (ship, review, merge, watch CI until green), then the stable stage (ship official, review, merge, watch CI until green). Implies `--ship` for both stages; supersedes `--beta`. |
| `--advice` | Run the whole pipeline under `kongming` advisory supervision, authoring plans formatted for handover to lower-capability executor models with verify-fail escalation (see Advisory supervision). Composes with any ship mode. |
| `--ultra` | Run `/ak-plan` and `/ak-code-review` in ultra verifier mode (best-of-5 candidate pass; opt-in only, significantly increases run cost/time). |
| no `--beta` | Ship stable via `/ak-ship official`; final ready label is `ready to ship stable`. |
| no `--ship` | Stop after PR is reviewed, fixed, replied, and labeled ready. |

Mode resolution: `--both` > `--beta` > default stable. If `--both` and
`--beta` are given together, warn once and proceed in `both` mode. `--advice`
and `--ultra` compose with every ship mode. `--ultra` applies to `/ak-plan`
and `/ak-code-review` only. When `--advice` is present, forward `--advice` to
all supporting skills that accept it (`/ak-plan`, `/ak-cook`, `/ak-fix`,
`/ak-code-review`, `/ak-ship`, `/ak-review-pr`, `/ak-test`; forward to
`/ak-docs` only when its installed mode supports the accepted advisory
contract).

## Evidence and continuation

Keep one controller record of accepted scope, plan/diff revision, completed
checks, findings and open decisions; pass each downstream skill only the
context it needs. Reuse results for unchanged inputs and invalidate them after
relevant edits. Continue authorized work through PR readiness without pausing
between steps.

## Batch-landing repositories

When the repository's own instructions (`CLAUDE.md`, `AGENTS.md`, or its
contributing or workflow docs) declare a batch-landing owner (a merge train,
landing bot, or scheduled routine) that lands PRs instead of per-PR CI and
author merges, `/ak-ship` opens the PR ready for review with the local
verification evidence those instructions name, then stops. Vibe follows the
same boundary:

- Step 11 still reviews, fixes, and replies on the diff, but local verification
  evidence replaces PR checks; do not wait for checks that will not run.
- Step 12 applies the ready label as usual.
- Step 13 does not run, even with `--ship` or `--both`: do not enable
  auto-merge, merge, or watch target-branch CI. Report merge as delegated to
  the landing owner, and with `--both` report the stable stage as
  `pending beta merge`.

## Subagents

The controller owns interpretation and every gate. Delegate only large,
separable work, and use fresh-context subagents for review and verification.
Parallel writers in one worktree need disjoint file ownership, because
overlapping writes clobber each other: name one owner for shared schemas,
exports or configs, and fix interfaces before fanning out. The controller runs
whole-worktree validation, staging and commit.

When the runtime cannot start a fresh-context subagent for review, use an
installed herdr-core (`hc`) session instead if it qualifies per the
ak-orchestrate herdr-core route reference: same runtime, its
own read-only worktree, no write or destructive authority. Report its findings
as harness-attested. Without a qualifying `hc` route, nothing changes.

## Advisory supervision (`--advice`)

When `--advice` is present, run the whole pipeline under `kongming`
supervision (`../ak-brainstorm/references/advisory-supervision.md` for identity
and model routing). Kongming returns counsel, never code; the main agent stays
responsible for every decision, edit, and gate. Plans created in step 4 follow
the handover contract in `../ak-plan/references/advice-handover-plan.md`.

Spawn `kongming` at these checkpoints. A downstream advisory review satisfies a
checkpoint when it covers the same scope, revision and question; record its
receipt rather than repeating it. New failures or materially changed evidence
require fresh counsel.

- **After each phase:** investigation, plan gates, implementation, local code
  review, testing/docs. Pass the phase goal, what changed, and the evidence;
  ask for go/no-go and the next risk to watch.
- **When stuck:** repeated failures, a blocked step, or contradictory evidence.
- **Before a high-stakes decision:** a design fork, a public-contract or
  security-sensitive change, or an irreversible action (including a promotion
  merge that sweeps unrelated work).
- **On verification failure:** when any verification step, test gate, or
  sanity check fails during implementation, stop and send `kongming` the exact
  command, output, and context before touching code again (the failure
  protocol in `../ak-plan/references/advice-handover-plan.md`).
- **Mandatory post-PR review gate:** once the PR is reviewed and its CI is
  terminal and green (in a batch-landing repository, once review/fix
  converges), spawn `kongming` to review the whole implementation and post its
  assessment plus concrete next steps as a comment on the PR and the source
  issue. In `--both` mode this runs for the beta PR and again for the stable PR.

`--advice` adds supervision; it never bypasses approval gates, tests, review blockers, branch protections, or security policy.

## Pipeline

1. **Parse and analyze request**
   - Strip `--ship`, `--beta`, `--both`, `--advice`, and `--ultra`, then resolve ship mode. `--both` implies `--ship`.
   - A GitHub issue URL/number is the source of truth; do not create a duplicate. Natural-language input is the feature request; its issue is created after plan validation/red-team (step 5).
   - Resolve the repo with `gh repo view --json nameWithOwner,defaultBranchRef`. If an issue URL's `OWNER/REPO` differs, stop and ask the user to switch to the matching repo/worktree or provide an issue from the current repo.
   - Read the issue title, body, and comments with `gh issue view`. Extract outcome, acceptance criteria, scope boundary, constraints, blockers, and likely touched surfaces.
   - Classify the route:
     - **Bugfix route** for a bug, regression, broken behavior, failing test/CI, incident, error log, or an explicit fix/debug/repair request.
     - **Feature route** for net-new capability, enhancement, refactor, or ambiguous product work.
   - If the request names a specific library, framework, SDK, API, or service, mark it for research in step 3.
   - Detect an existing plan in this order, verifying the resolved `plan.md` exists on disk before reusing it: (1) a user-provided plan path; (2) for an issue input, `ak plan search --issue <n>` (plan state is files-first; the index resolves a plan by issue number without a GitHub link); (3) the current-plan pointer, then `ak plan resolve` (repo + branch); (4) an issue body/comment linking a `plans/.../plan.md`, or a matching plan already in the current worktree. Detection runs before worktree creation, so an unset pointer or `ak plan resolve` miss is expected. If `ak` is missing/errors, or `resolve` reports an ambiguity, present the candidates and fall through to the file/issue scan. Keep that scan first-class: a teammate-created plan may exist only as repo files plus an issue link, because the index is per-machine.
   - If any of this is ambiguous enough to change implementation, ask before worktree creation.

2. **Create or reuse isolated worktree and branch**
   - Reuse the current worktree when it is already isolated (`git rev-parse --git-common-dir` != `git rev-parse --git-dir`) on a dedicated feature branch, or when an existing clean feature worktree/branch already matches the request (record why).
   - Otherwise activate `/ak-worktree` with a descriptive branch name from the issue/request.
   - Never work directly on `main`, `master`, `dev`, `beta`, or `develop`.

3. **Pre-plan investigation (conditional)**
   - **Research:** if technology was detected in step 1, run `/ak-research "<tech topics>"` and feed findings into planning.
   - **Debug:** on the bugfix route, run `/ak-debug "<error/failure + evidence>"` to prove the root cause, and feed it into `/ak-plan` and `/ak-fix`.
   - Triggers, skip rules and flag forwarding: `references/pipeline-skill-integration.md`.

4. **Plan intake and gates**
   - If a valid existing `plan.md` was detected, use its absolute path and skip `/ak-plan --tdd`.
   - Otherwise, in the active worktree activate the following and capture the absolute `plan.md` path:
     ```bash
     /ak-plan --tdd "<source issue or feature request>" [--ultra] [--advice]
     ```
   - Require evidence for both gates, even when the plan already existed:
     ```bash
     /ak-plan validate <plan.md>
     /ak-plan red-team <plan.md>
     ```
   - Do not proceed to implementation while validation failures, accepted red-team findings, or unresolved contradictions remain.

5. **Create or update GitHub issue**
   - Ensure labels exist:
     ```bash
     gh label list --json name --jq '.[].name' | grep -Fx "ready to cook" >/dev/null \
       || gh label create "ready to cook" --color "0E8A16" --description "Plan validated; ready for ak-cook or ak-fix"
     gh label list --json name --jq '.[].name' | grep -Fx "in progress" >/dev/null \
       || gh label create "in progress" --color "FBCA04" --description "Implementation is in progress"
     gh label list --json name --jq '.[].name' | grep -Fx "ready to ship stable" >/dev/null \
       || gh label create "ready to ship stable" --color "5319E7" --description "PR reviewed and ready for stable merge"
     gh label list --json name --jq '.[].name' | grep -Fx "ready to ship beta" >/dev/null \
       || gh label create "ready to ship beta" --color "1D76DB" --description "PR reviewed and ready for beta merge"
     ```
   - If label creation fails for anything other than an existing label, stop and report the exact `gh` error.
   - Update/comment on the source issue, or create a new issue for natural-language input, using the issue body in `references/report-templates.md`. Include branch, route (`feature` via `/ak-cook` or `bugfix` via `/ak-fix`), implementation summary, plan link relative to the repo root, ship mode (`official`, `beta`, or `both`), and acceptance criteria.
   - Add `ready to cook`; remove stale `ready to ship stable` and `ready to ship beta`.
   - Record the linkage in the plan index so later runs resolve this plan by issue number: `ak plan update --issue <issue-number>` (add `--root-comment-id <id>` when a tracking comment was posted). Follow the publish-safety protocol in the shared files-first plan-state reference for author-verification and idempotent projection.

6. **Implement or fix**
   - Before activating `/ak-cook` or `/ak-fix`, update the issue (drop `--remove-label` when `ready to cook` is absent):
     ```bash
     gh issue edit <issue-number-or-url> --add-label "in progress" --remove-label "ready to cook"
     ```
   - If the label update fails for any other reason, stop and report the exact `gh` error. Do not start implementation while the issue state still says `ready to cook`.
   - Bugfix route, passing the failure evidence, plan path, scope boundary, and acceptance criteria:
     ```bash
     /ak-fix --auto <plan.md> [--advice]
     ```
   - Feature route:
     ```bash
     /ak-cook --tdd --auto <plan.md> [--advice]
     ```
   - If implementation stops for a user/business decision, update the GitHub issue with blocker details and stop.

7. **Review local implementation**
   ```bash
   /ak-code-review --pending [--ultra] [--advice]
   ```
   Fix Critical and Important findings before shipping, then re-run relevant validation.

8. **Quality and testing (conditional)**
   - Activate `/ak-test create|audit|optimize [--advice]` when observable behavior, boundaries, or invariants changed and `/ak-cook --tdd` or `/ak-fix` coverage is not already adequate. No pass-only or tautological tests.
   - Rules: `references/pipeline-skill-integration.md`.

9. **Documentation sync (conditional & mode-aware)**
   - In `official` mode: skip in-repo `/ak-docs update` (owned by `/ak-ship official` in background to prevent write races); record docs impact in the PR.
   - In `beta` mode: run `/ak-docs update` when public contracts, APIs, or agent context changed.
   - For official docs in an external repo (e.g. `bestagentkits/agentkit-docs`): search existing issues, then file or link a follow-up issue with the `ai-handle` label.
   - See `references/pipeline-skill-integration.md`.

10. **Ship PR**
    - Activate `/ak-ship beta` for `--both` or `--beta`, otherwise `/ak-ship official`; pass `--advice` if set. With `--both`, the stable stage runs later, in step 13, only after beta merge and beta CI success.
    - Capture the PR URL/number from `/ak-ship` output.
    - `/ak-ship` finalizes a plan-backed change itself (`status: completed` in the ship commit, `--linked-pr` after PR creation). The index `close` is deferred to merge (step 13).

11. **Review/fix/reply PR**
    ```bash
    /ak-review-pr <pr-url-or-number> --fix --reply
    ```
    - Pass `--advice` if set on vibe.
    - Do not continue until actionable findings are resolved or an external blocker is documented.
    - PR checks must be terminal and green unless the blocker is external and recorded. In a batch-landing repository, local verification evidence replaces PR checks (see Batch-landing repositories).
    - With `--advice`, run the mandatory post-PR review gate (see Advisory supervision).

12. **Apply ready label**
    - Beta mode: `ready to ship beta`. Both mode: `ready to ship beta` now; `ready to ship stable` is added in step 13 when the stable-stage PR passes review. Otherwise: `ready to ship stable`.
    - Add the label to both the source issue and PR when possible.
    - Remove `ready to cook` and `in progress` after PR review/fix succeeds.

13. **Optional merge and CI convergence**
    - Only run this step when `--ship` or `--both` is present, and never in a batch-landing repository (see Batch-landing repositories).
    - Merge via GitHub using repository convention and branch protection; prefer `gh pr merge --auto` when required checks are still pending.
    - Never force push. Never direct-push to protected target branches.
    - After merge, watch target-branch CI/deploy workflows for the merge commit.
    - On merge success, finalize the plan index: match the merged PR to its plan (recorded `--linked-pr`, or plan branch == PR head branch) and run `ak plan close <id>`; optionally append a completion comment to a linked issue per the shared reference's "Delivery finalization" section. A resolve/match miss means already closed or no plan; skip silently. Never delete plan files.
    - If CI fails with a deterministic repo-fixable error: inspect the failed run with `gh run view`, create a follow-up fix branch/worktree from the target branch, run `/ak-fix --auto` with the exact failing command and error, ship it in the same mode (during `--both`, the current stage's mode), run `/ak-review-pr --fix --reply`, merge, and watch again.
    - Stop only when target-branch CI succeeds, an external blocker remains, or the same blocker survives 3 fix attempts.
    - **Dual-stage (`--both`) sequence:**
      1. **Beta stage:** merge the beta PR and watch beta/dev-branch CI to green using the merge and fix loop above.
      2. Do not start the stable stage while beta CI is red, pending, or blocked. If the beta stage ends on an external blocker or exhausts fix attempts, stop, report, and mark the stable stage as skipped.
      3. **Stable stage:** after beta CI is green, ship stable. Pick the path from how the beta merge landed:
         - If the repository promotes beta/dev into stable by convention (release/promotion PR from dev to main), follow that convention. Before merging a promotion PR, list the commits it carries; if it sweeps unrelated work beyond this issue, stop and ask the user instead of merging silently.
         - If stable receives feature PRs directly, activate `/ak-ship official` from the feature branch.
      4. Capture the stable PR, run `/ak-review-pr <stable-pr> --fix --reply`, apply `ready to ship stable` to the source issue and stable PR, and remove `ready to ship beta`. With `--advice`, run the mandatory post-PR review gate for the stable PR too.
      5. Merge the stable PR and watch stable-branch CI to green with the same merge and fix loop. The run is complete only when stable CI succeeds or a documented external blocker remains.

## Security

- Never write secrets, tokens, customer data, or private env values into issues, PRs, comments, plans, or logs; redact command output before posting to GitHub.
- If `gh` auth lacks permission to create labels, issues, PRs, reviews, or merges, stop and report the exact missing capability.
- Record CI failures caused by missing secrets, unavailable services, or required human approval as external blockers.

## Completion Report

End every vibe run with the completion report in `references/report-templates.md`,
including a run-or-skipped disposition with reason for `Research`, `Debug`,
`Test`, and `Docs`, and review severity counts taken from the actual review,
never fabricated scores.
