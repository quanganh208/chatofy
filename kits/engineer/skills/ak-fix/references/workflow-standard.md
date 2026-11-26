# Standard Workflow

For moderate, multi-file issues. The parent skill captures the opening intent frame before this
route loads. Track the phases in the live task-management surface when available, otherwise in
the active plan; plan files are the durable source of truth.

Run the phases in this order; each starts only after the previous one has its evidence:

1. **Scout.** Map affected files, module boundaries, dependencies, related tests and recent
   changes with `ak-scout`. Delegate scouting only for large separable areas and when the
   runtime permits it; see `references/parallel-exploration.md`.
2. **Diagnose.** Capture the pre-fix state (exact errors, failing output, stack traces), then
   use `ak-debug` to prove the cause against `references/diagnosis-gates.md`. After two refuted
   hypotheses, consider `ak-problem-solving`. Compare only cause-aligned fixes; if several
   viable approaches or an architecture decision remain, use `ak-brainstorm` and switch to
   `references/workflow-deep.md`.
3. **Implement** the cause-aligned fix with minimal changes, preserving the opening
   constraints and non-goals.
4. **Verify and prevent.** Rerun the exact pre-fix commands and compare. Add a regression test
   that fails without the fix. Run the side-effect sweep in `references/diagnosis-gates.md`,
   then typecheck, lint, build and tests. On failure, return to Diagnose; after three attempts,
   stop and question the architecture with the user.
5. **Review** the changed files per `references/review-cycle.md`.
6. **Finalize.** Report root cause, changes, prevention and confidence; sync plan status with
   `ak-project-management`; update docs only for affected authority surfaces; commit only when
   authorized; run `/ak-journal` unless the shared "Journal step — opt-out" applies (see
   SKILL.md; skip when `--skip-journal` or `journal.auto=false`).

For frontend fixes, verify in a browser with `ak-agent-browser`, Chrome MCP /
`chrome-devtools-mcp`, or project-native browser tests.
