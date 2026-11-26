# Debate Mode (`--debate`)

Shared evidence → 3 independent candidate plans → synthesize one final plan → Red Team → Validate → Hydrate Tasks.

Unlike `--two` (2 approaches drafted by the same planning pass, user picks one), `--debate` runs 3 fully independent `planner` subagents with no cross-reading, and the orchestrator synthesizes one plan from all 3, recording agreements/disagreements explicitly.

## Execution Sequence

1. **Build the shared evidence packet**: Run the same research step `--hard` mode uses and persist it to `{plan-dir}/reports/debate-evidence-packet.md`.
2. **Scaffold and read**: Scaffold with `ak plan` and run the generated-file read pass per `cli-integration.md`.
3. **Dispatch 3 parallel `planner` subagents**: Build prompts from the shared evidence packet; each writes to `{plan-dir}/reports/planner-debate-candidate-{N}.md`.
4. **Usable candidate gate**: Verify all 3 candidates produced valid plans. If any slot fails, run one bounded re-dispatch.
5. **Synthesize one plan**: Compare candidate architectures, identify consensus and disagreements, and write final `plan.md` + `phase-*.md`.
6. **Run Red-Team & Validation gates** before task hydration.
