# Review Progress Coordination

Use the live task-management surface when the runtime has one; otherwise track state in
the active plan. Plan files are the durable source of truth. Skip tracking for a review of
fewer than three meaningful steps.

- Keep the order scout, review, fix accepted Critical and Important findings, verify with
  fresh evidence.
- Parallel reviews split only independent file or subsystem scopes, record one owner per
  scope before dispatch, and join all results before the shared fix step. Keep findings in
  reports or the plan, not only in session state.
- If fixes introduce new issues, run another review cycle. After three cycles, ask the user
  how to proceed.
- Before claiming completion, reconcile the plan: update every affected phase checkbox
  (including stale earlier phases) and record unresolved findings.
