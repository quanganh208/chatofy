# Ultra Verifier Mode (`--ultra`)

Best-of-5 independent candidate plans → single strongest-model verifier selection → materialize winner unchanged.

Follows the shared Ultra Verifier protocol in `../../ak-brainstorm/references/ultra-verifier-mode.md` (evidence packet, usable-candidate gate, anonymization, reject-all, receipt). Plan-specific steps:

1. **Scaffold and read**: Scaffold with `ak plan` and run the generated-file read pass per `cli-integration.md`.
2. **Dispatch 5 parallel `planner` subagents**: Each prompt carries the identical evidence packet and writes to `{plan-dir}/reports/planner-ultra-candidate-{N}.md`.
3. **Verify**: `kongming` scores the anonymized candidates against the rubric.
4. **Materialize winner**: Write the winning candidate into `plan.md` + `phase-*.md` unchanged; record the ranking appendix in the report.
5. **Run Red-Team & Validation gates** before task hydration.
