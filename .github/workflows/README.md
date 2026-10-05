# GitHub Actions Workflows

## Current workflows

| File                     | Purpose                                                                        |
| ------------------------ | ------------------------------------------------------------------------------ |
| `ci.yml`                 | Lint, typecheck, test, build and the gate jobs. On every PR and push to `main` |
| `deploy.yml`             | Deploys production, on a self-hosted runner, after CI succeeds on `main`       |
| `main-failure-alert.yml` | Opens an issue when CI fails on `main`, and closes it when main is green again |

Job lists live in the files themselves, so this table stays a map rather than a
copy that drifts.

## Two triggers worth knowing

Both `deploy.yml` and `main-failure-alert.yml` react to CI with `workflow_run`
instead of `on: push`. A push trigger would start in parallel with CI and could
act on a run that has not finished — which reads like a gate and is not one.
Both also match CI by its `name:` field, not its filename, so renaming CI
silently stops them firing with no error anywhere.

## Notes

- `ci.yml` sets `concurrency` with `cancel-in-progress: true`, so a new push to
  the same ref cancels the run it replaces. `deploy.yml` deliberately does the
  opposite: it never cancels, because a run can be sitting between `pg_dump` and
  `migrate deploy`, which is exactly when killing it hurts.
- Turborepo remote caching is not wired up (CI reports "Remote caching
  disabled"). `TURBO_TOKEN` + `TURBO_TEAM` would turn it on and cut build time.
