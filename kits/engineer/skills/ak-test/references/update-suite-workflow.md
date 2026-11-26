# Update Suite Workflow

`update` reconciles existing tests with a behavior or contract change. It edits
tests only where the accepted expectation changed; it never edits a test to fit
what the code happens to do now.

## 1. Establish the changed contract

- Name the change and its authority: an accepted issue, plan, spec, schema, API
  contract, or an explicit user decision. A diff alone is not authority for a new
  expectation.
- List the observable behaviors that changed, were added, or were removed, and
  the behaviors that must stay unchanged.
- When the authority is missing or contradicts the code, stop and report the
  conflict instead of choosing a side by editing tests.

## 2. Map affected tests

- Find tests that exercise each changed behavior: direct callers, fixtures,
  snapshots, golden files, contract tests, and CI lanes that select them.
- Run the affected set before editing to record which tests fail and why.
- Classify every failure: expected by the new contract, an implementation
  defect, an environment problem, or a stale or weak test.

## 3. Change tests per class

| Class | Action |
|---|---|
| Expected by the new contract | Update the assertion to the new accepted value and cite the authority in the commit or report. |
| Implementation defect | Keep the test; hand the defect to `ak-debug` or `ak-fix`. |
| Environment problem | Fix or report the environment; do not touch the assertion. |
| Removed behavior | Retire the test per `test-lifecycle.md`, keeping any invariant that still holds. |
| New behavior without coverage | Add the lowest-layer test that proves it, per `create-suite-workflow.md`. |

Regenerate snapshots or goldens only after reading the diff they would record
and confirming every change is expected by the contract.

## 4. Verify

- Re-run the affected set, then the broader lane the change touches.
- Show that each updated test fails against the old behavior or a deliberate
  mutation, so the update did not turn it into a test that always passes.
- Report per `report-format.md`: changed tests with the authority for each,
  retired tests, new tests, defects handed off, and any unresolved conflict.

`update` never deletes, skips, or loosens a failing test to obtain a green run.
