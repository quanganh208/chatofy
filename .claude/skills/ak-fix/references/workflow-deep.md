# Deep Workflow

For system-wide issues, architecture decisions or competing fixes. The parent skill's opening
intent frame is already satisfied; the brainstorm here is a later solution decision grounded in
diagnosis and does not repeat the opening contract. Track phases and their dependencies in the
live task-management surface when available, otherwise in the active plan; plan files are the
durable source of truth.

Phase order matters. Scout, Diagnose and Research may run in parallel when the runtime permits
the delegation; every later phase starts only after the ones before it have their evidence.

1. **Scout.** Map all affected files, module boundaries, call chains and test coverage gaps
   with `ak-scout`. Delegation rules are in `references/parallel-exploration.md`.
2. **Diagnose.** Capture all pre-fix errors, failing tests, stack traces and logs, then use
   `ak-debug` (systematic debugging and root-cause tracing) to prove the cause against
   `references/diagnosis-gates.md`. After two refuted hypotheses, consider
   `ak-problem-solving`.
3. **Research** current docs, similar issues and relevant security advisories.
4. **Brainstorm** approaches with `ak-brainstorm`, comparing each against the opening
   constraints, non-goals and acceptance criteria. Explicit auto mode may take the documented
   recommendation without a routine pause.
5. **Plan** the phases, dependencies, success criteria and prevention measures in a durable
   plan.
6. **Implement** the root-cause fix phase by phase with minimal changes.
7. **Verify and prevent.** Rerun the exact pre-fix commands and compare. Add regression tests
   that fail without the fix. Run the side-effect sweep in `references/diagnosis-gates.md`,
   then typecheck, lint, build and tests; cover boundary, security and performance edge cases
   the change touches. On failure, return to Diagnose; after three attempts, stop and question
   the architecture with the user.
8. **Review** per `references/review-cycle.md`.
9. **Finalize.** Report root cause, evidence chain, changes, prevention and confidence; sync
   plan status with `ak-project-management`; update docs only for affected authority surfaces;
   commit only when authorized; run `/ak-journal` unless the shared "Journal step — opt-out"
   applies (see SKILL.md; skip when `--skip-journal` or `journal.auto=false`).

For frontend fixes, verify in a browser with `ak-agent-browser`, Chrome MCP /
`chrome-devtools-mcp`, or project-native browser tests.
