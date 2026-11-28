# Handover Plan Contract (`--advice`)

Under `--advice`, the plan is written to be executed by a different, weaker
model (Sonnet-class or Flash-class) that follows instructions well but
under-infers: it will not reconstruct a missing step, guess an unstated path, or
notice on its own that it has gone off the rails. The plan must let it run end to
end without inventing anything.

Supervisor identity and model routing stay in
`../../ak-brainstorm/references/advisory-supervision.md`. This file governs only
the shape of the plan artifact.

The executor reads only `plan.md` and the `phase-NN-*.md` files, never this
reference. Everything below must be materialized into the generated phase files.

## Relationship to the standard phase template

This contract is a delta over the canonical phase-file template in
`cli-integration.md` (Goal / Files to Create or Modify / Tasks & Steps /
Verification). Keep that structure and add the handover fields below. Where the
richer section list in `plan-organization.md` overlaps these fields, the handover
fields are authoritative and additive — do not drop a handover field because a
similarly named section already exists.

Precedence when `--advice` combines with other modes:
- `--tdd`: the test-first commands become the `Verify` field's mechanical pass
  condition. When a task requires a failing test first (red phase), state that
  explicitly as the pass condition (e.g. `Verify: test command exits non-zero with
  assertion failure; passing test is a failure`) so the expected red state is
  not mistaken for a verification failure. The regression gate is one of the
  verification steps.
- `--deep`: keep the deeper inventories and scenario matrices; still decompose
  each phase into the per-task fields below.
- `--parallel`: the handover fields apply per task within each parallel phase;
  strict file-ownership boundaries are stated in each task's target files.
- `--html`: `plan.html` may be the authoritative artifact, but the executor
  reads markdown, not HTML. The `phase-NN-*.md` files must still carry the full
  handover fields and the literal Failure Protocol block; never reduce them to a
  thin index under `--html`.

## What each phase must contain

Every phase decomposes into an ordered list of tasks, each one self-contained
unit the executor can finish and check before moving on. For each task, state:

- **Goal** — the one observable outcome this task produces.
- **Target files and symbols** — exact paths and, where it matters, the function,
  type, endpoint, or config key to touch. Never "update the relevant file".
- **Steps** — the ordered actions to reach the goal, with no intermediate step
  left for the executor to infer.
- **Success criteria** — something the executor can observe.
- **Verify** — either an explicit `no verification needed` for a pure edit whose
  effect the next task's verification already covers, or a mechanical pass
  condition: the exact command and the exact expected result (exit code,
  output substring, file that must now exist, or value). "Confirm it works" is
  not a verification; "`go test ./auth/...` exits 0 and prints `ok`" is.

Example task:

```markdown
### Task 2.3 — Add the 401 branch to the auth middleware
- Goal: unauthenticated requests to protected routes return HTTP 401.
- Target files: `src/server/middleware/auth.ts` (function `requireAuth`).
- Steps:
  1. In `requireAuth`, after the token lookup, add: if no token, respond 401.
  2. Export nothing new; the middleware is already wired in `src/server/app.ts`.
- Success criteria: a request with no `Authorization` header gets 401, not 500.
- Verify: `npm test -- auth.middleware` exits 0 and prints `401 unauthorized`.
```

## Failure Protocol (materialize this block in every phase file)

Every phase file must literally contain this block so the executor carries the
escalation rule with the work:

```markdown
## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same
failure evidence to the user. Never continue by self-reasoning.
```

The STOP is the load-bearing part: an executor without a `kongming` subagent
must still stop and hand the failure back. The protocol applies whenever a Verify
step fails, whether or not the executor itself was invoked with `--advice`.

## Handoff note

In the post-plan handoff (`post-plan-handoff.md`), state that the plan is
handover-ready and that each phase carries its own Failure Protocol, so stopping
on a failed check reads as intended behavior, not a stall.
