## Ultra Verifier Mode (`--ultra`)

When `--ultra` is present, run the brainstorm through the shared best-of-5
protocol in `ultra-verifier-mode.md` (evidence packet, five read-only
candidates, anonymized verifier, usable-candidate gate, fail-closed runtime
rule, reject-all), with:

- **Candidate task:** each candidate produces a complete bounded contract —
  outcome, constraints, non-goals, acceptance criteria, plus Trade-offs and
  Better approaches when applicable — and its recommended direction.
- **Rubric:** faithfulness to the request, evidence grounding, sharpness of the
  acceptance criteria, honesty about unknowns, and correct application of
  conditional fields (including Trade-offs assumption/failure analysis and the
  required omission-versus-evidence-backed-none behavior for Better approaches).
- **Finalizer:** the verifier selects the single winning contract; the
  controller emits that winner unchanged (it does not blend candidates) and
  records a short ranking appendix. On reject-all, hard-stop and report why.

`--ultra` composes with `--html`, `--report`, `--advice`, and `--yagni`, and
adds no new conflicts.
