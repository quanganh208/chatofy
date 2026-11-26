# Verification Roles

Roles for verifying plan claims against the actual codebase. Loaded by the
planner (self-verify during creation), validate (after creation), and red-team
(evidence-backed adversarial review).

## Tiering (Auto-Scale by Plan Size)

| Phases | Tier | Active Roles | Spot-Check Budget |
|--------|------|-------------|-------------------|
| 1-2 | Light | Fact Checker | 5 claims/phase |
| 3-4 | Standard | Fact Checker + Contract Verifier | 10 claims/phase |
| 5+ | Full | All 4 roles | 15+ claims/phase |

## Roles

- **Fact Checker:** every cited file path, symbol, endpoint, and config key
  exists (paths from scout reports may have moved since scouting). Output per
  claim: `VERIFIED (file:line)` | `FAILED (not found)` | `UNVERIFIED (ambiguous)`.
- **Flow Tracer:** behavioral claims ("X triggers Y") follow a real call path
  from the entry point, including guards, early returns, middleware, and async
  ordering; causality, not co-location. Output: traced path with file:line, or
  FAILED with the actual flow.
- **Scope Auditor:** new state (fields, context values, singletons, env vars)
  respects its lifetime (request, session, process) across all instantiation
  sites and does not duplicate existing state. Output: lifetime classification
  with instantiation sites, or FAILED with the leak.
- **Contract Verifier:** interface changes account for every consumer. State the
  caller count and list them (first 10 with file:line when more), including
  tests, re-exports, config, CI scripts, and CLI help text; never write "update
  all callers". Output: caller list and compatibility assessment, or FAILED with
  missing callers.

## Verification Output Format

Append to plan's `## Validation Log` or include in red-team findings:

```markdown
### Verification Results
- **Tier:** Light|Standard|Full
- **Claims checked:** N
- **Verified:** N | **Failed:** N | **Unverified:** N

#### Failures
1. [Fact Checker] `src/utils/auth.ts` — path not found, actual: `src/lib/auth.ts`
2. [Contract Verifier] `parseConfig()` — plan says 3 callers, found 7
```

## Whole-Plan Consistency Sweep

Run after any validation or red-team change that edits `plan.md` or any
`phase-*.md`, so a fix in one phase does not leave stale claims elsewhere.

1. Re-read `plan.md` and all `phase-*.md` files after applying edits.
2. List the decision deltas from the current session: renamed fields, APIs,
   files, tags, scopes, or workflows; changed or rejected assumptions; changed
   phase order, dependencies, ownership, or success criteria.
3. Search all plan files for old terms, superseded assumptions, and duplicate
   embedded drafts (SQL, queries, API bodies, commands) from each delta, and
   reconcile every affected section, not only the file that triggered it.
4. If a conflict cannot be resolved with current evidence, add it to unresolved
   questions and ask the user before recommending implementation.

Append to the current `## Validation Log` or `## Red Team Review` section:

```markdown
### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01-..., phase-02-...
- Decision deltas checked: N
- Reconciled stale references: N
- Unresolved contradictions: N
```

Never recommend cooking while unresolved contradictions remain.

## Integration Points

- **Planner self-verify:** Apply Fact Checker inline while writing each phase. Tag `[UNVERIFIED]` for claims that can't be confirmed.
- **Validate:** Run tier-appropriate roles after reading the plan, before interview questions; FAILED findings become interview topics. Run the sweep after propagation.
- **Red-team reviewers:** Each reviewer carries their adversarial lens plus an assigned verification role. Run the sweep after accepted edits.
