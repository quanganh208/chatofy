# herdr-core Session Route

Load before declaring "no session route" when the current runtime exposes no
qualifying session-start surface. herdr-core (`hc`) is an optional,
user-installed terminal multiplexer for agent sessions. AgentKit does not ship,
install or configure it; this route exists only when the user already has it.

`hc` is a **session host**, not a supervisor. It hosts current-runtime sessions
for `runtime: internal` jobs, which the coordinator dispatches and settles with
`advance`/`accept`. It never replaces a CLI or Pi job that `advance` blocked
with `unsupported_platform`: that job stays blocked, and it is never
re-labelled `internal` to run through `hc`.

## Detection

Probe in this order and stop at the first failure:

1. `hc --version` exits 0. Record the version in `<run-dir>/runtimes.json` as
   install evidence, not route evidence.
2. `hc ls` exits 0. It proves the multiplexer is reachable from this shell.
3. Read `hc --help` and each subcommand's `--help`. A listed verb or flag moves
   that operation to `unverified` only; a help string never proves support.
4. Qualify each operation from observed behavior per the
   [session-routing.md](session-routing.md#live-discovery) table and the
   [Session Versus Subagent](session-routing.md#session-versus-subagent) tests:
   an operation is `supported` only after a round trip was observed on a
   throwaway session (for `send`, the reply came from the same address; for
   `resume`, the recorded address still answered after the coordinator
   restarted or re-read state).

The route qualifies only when `create`, `observe`, `send` and `cancel` are
`supported`. Otherwise, and whenever `hc` is absent or a probe fails, nothing
changes: continue with the existing routing and report "no route" exactly as
before.

## Lifecycle Mapping

These are the expected verbs; confirm each with step 3 and 4 before use. A
missing verb or flag leaves that operation `unsupported`.

| Session operation | Expected `hc` command |
| --- | --- |
| `create` | `hc run --cwd <worktree> <current-runtime session command>` |
| `observe` | `hc get <address>` for state, `hc read <address>` for output |
| `send` | `hc send <address> <message>` |
| `resume` | `hc get <address>`, then a successful `hc send` to the same address |
| `cancel` | `hc interrupt <address>`, then `hc kill <address>` if it does not settle |

- **Handle:** the terminal address `hc run` reports. Record it with the attempt
  ID exactly as printed; never synthesize one. If the address does not survive
  an `hc` restart, record `resume` as `unsupported`.
- **Isolation:** one worktree per job, passed as `--cwd`. Never share a
  worktree between two `hc` sessions that write.
- **Runtime scope:** `hc` hosts the current runtime only. Hosting another
  runtime is a cross-runtime route and needs the run's opt-in per
  [model-routing.md](model-routing.md).
- **Permissions:** `hc` cannot set a permission posture; the hosted session
  runs with the user's terminal authority. Record `permissions` as
  `unverified` unless the hosted runtime's own flags set a posture equal to or
  below the coordinator's. Without that, do not dispatch jobs that need
  approval gates or destructive effects.

## Evidence

- Check commands go under descriptive `checks:` and run in the harness; report
  each command, exit status and output as **harness-attested**, never as
  supervisor-verified. A job whose user or supplied spec declares
  `verification:` still blocks off Darwin; never convert it.
- Status and output come from what `hc get`/`hc read` actually showed. Never
  fabricate a status the multiplexer did not report.
- Accept only a settled attempt with verified artifacts, never a session's
  report alone.
