# CI/CD Fix Workflow

For GitHub Actions failures and CI/CD pipeline issues.

## Prerequisites
- `gh` CLI installed and authorized
- GitHub Actions URL or run ID

## Workflow

Fetch the logs, find the cause, fix it, and reproduce the failing step locally before pushing.

```bash
gh run view <run-id> --log-failed
gh run view <run-id> --log
```

Read the steps before the failed one too; env vars, dependencies, permissions and timeouts are
the usual causes. If `gh` is unavailable or unauthorized, ask the user to run `gh auth login`.
