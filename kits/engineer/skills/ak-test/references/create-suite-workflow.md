# Suite Creation Workflow (`create`)

Create a test suite that covers the project's features and workflows, grounded
in what the code and docs actually do.

## 1. Scout the codebase and docs

Inspect the requested scope directly; use installed `ak-scout` for larger
independent areas only when its cost is justified. Cover entry points and public
APIs, workflows described in `docs/` and the README, existing tests (framework,
layout, helpers, fixtures, naming), behavior-changing configuration, and visible
error paths and boundaries.

Output: a scout report listing features, workflows, and their owning files.

## 2. Build the coverage matrix

Map affected features/workflows to their intended coverage. Bootstrap the whole
project only when that is the requested scope:

| Feature / workflow | Owner files | Level (unit/integration/e2e) | Exists? | Priority |
| --- | --- | --- | --- | --- |

Reuse the project's existing framework and conventions; never introduce a second
test framework beside a working one.

## 3. Design before writing

For each matrix row without coverage, define: the observable contract under
test, the failure a plausible bug would cause, fixtures needed, and isolation
requirements (no cross-test dependencies, deterministic, full-suite-safe).
Use `test-lifecycle.md` for admission and proof of value. Reuse adequate existing
tests; an empty addition list is valid when no protection gap remains.

With `--interview`: present the matrix and the planned test list; interview the
user per group before writing. With `--ultra`: fan this design step per the
skill's Ultra Verifier Mode. With `--advice`: checkpoint the matrix with
`kongming` before implementation.

## 4. Implement

- Demonstrate the intended failure using a pre-fix reproduction or bounded,
  isolated fault injection where safe and practical. Report unavailable proof.
- Wire coverage tooling when the project already defines it; target the
  project's threshold.

## 5. Verify and report

- Run new/affected tests, then repository-required gates.
- Report per `report-format.md`: matrix coverage before/after,
  tests added per level, gaps intentionally left (with reasons), and unresolved
  questions last.
