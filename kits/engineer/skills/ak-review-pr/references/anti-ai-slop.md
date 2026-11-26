# Anti AI-Slop Reference

Patterns that compile, pass tests and look fine per file but degrade the codebase in
aggregate, with the fix and when not to flag. Severity: structural and process slop are
**Important**; micro slop is **Suggestion**.

## 1. Structural slop (Important)

- **Dumping-ground file**: new `utils/helpers.ts`, `lib/common/index.ts`,
  `services/manager.ts`, `core/utils.go`. A generic name attracts unrelated additions.
  Detect with `git diff --name-status --diff-filter=A`. Fix: a domain-anchored name
  (`token-bucket-rate-limit.ts`), or move the function into its only caller.
- **Parallel reimplementation**: a new `formatDate()`, `slugify()`, retry wrapper when the
  repo already has one; the two copies diverge. Grep for prior art. Fix: use or extend the
  existing one.
- **Premature abstraction**: interface + factory + builder with one implementation. Fix:
  inline the concrete type until a second implementation exists.
- **Config flag for a constant**: `ENABLE_X`, `USE_NEW_Y` that nobody would flip in
  production; it doubles the test matrix. Fix: hardcode the value, delete the plumbing.
- **Schema or contract change without migration**: NOT NULL column, renamed field, changed
  response shape with no migration or compatibility path. Fix: migration, deprecation
  path, or versioned contract.
- **God-file growth**: a file pushed well past the project's size limit in one PR. Fix:
  split into a focused module before merge.
- **Phantom dependency**: a new dependency that the diff does not import, or uses for one
  call the stdlib covers. Fix: remove it.

## 2. Micro slop (Suggestion)

- **Defensive paranoia**: try/catch around code that cannot throw, null checks on
  typed-non-null parameters. Fix: delete the guard.
- **Catch-and-swallow**: `catch (e) { console.log(e) }`, `catch { return null }`,
  `except: pass`. Fix: handle the error (retry, fallback, user message) or propagate it.
- **Generic error messages**: `throw new Error("Failed")`. Fix: name the operation, inputs
  and failure (`"failed to fetch user %d: %w"`).
- **One-line wrappers** that add indirection and name no domain concept. Fix: inline.
- **Reimplemented stdlib**: custom `chunk`, `groupBy`, `debounce`, `deepEqual` when the
  language or an existing dependency covers it.
- **Silenced linter**: `any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `noqa`,
  `nolint` added to hide a warning. Detect with
  `git diff | grep -E '^\+.*(any|@ts-ignore|@ts-expect-error|eslint-disable|noqa|nolint)'`.
  Fix: resolve the cause, or explain why the linter is wrong.
- **Phantom test coverage**: assertions that always pass (`toBeTruthy()` on an always-truthy
  value). Fix: assert the value, side effect or error.
- **Mock-of-a-mock**: tests that mostly mock and assert the mock was called. Fix: real
  implementations, mocks only at integration boundaries.

## 3. Process slop (PR-level, Important)

- **Scope mismatch**: "fix typo" with +800/−60 across 12 files. Ask to split the PR or fix
  the title and description.
- **Unrelated files**: an auth fix that also rewrites a logging helper or bumps a dependency.
  Ask to move them to their own PR.
- **Tests missing or skipped**: production code changed with no test changes, or new
  `it.skip()` / `t.Skip()` / `@pytest.mark.skip` on passing tests. Block until covered or
  justified in the PR description.
- **Docs claim features the diff lacks**: remove the aspirational docs or block the
  incomplete implementation.

## 4. Phrasing

State the concrete cost in this codebase, tie it to a specific future risk, offer the
alternative, and say when it is a judgment call rather than a blocker. Do not write "this
is AI slop", cite principles (DRY/YAGNI/SOLID) instead of costs, ask vaguely to
"refactor", or present preference as review.

## 5. When not to flag

- A null check at a system boundary (API input, external response) is correct.
- A one-line wrapper that names a domain concept (`isWeekend(d)`) earns its place.
- Try/catch around legacy code with unknown failure modes is a reasonable hedge.
- An abstraction may be intentional if the second implementation is in the next PR; ask.
- Verbose error messages fit log and user boundaries.
- Repetition is fine when the abstraction would cost more (rule of three).
- Thin tests may be intentional smoke tests; magic numbers in tests are often clearer.
- Canonical idioms are not paranoia (Go `if err != nil { return err }`).

If you cannot state the concrete cost of a pattern in this codebase, do not flag it.
