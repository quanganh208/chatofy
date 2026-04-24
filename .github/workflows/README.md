# GitHub Actions Workflows

## Current workflows

| File     | Purpose                                                 |
| -------- | ------------------------------------------------------- |
| `ci.yml` | Lint + typecheck + build on every PR and push to `main` |

## CI placeholder

The CI workflow is intentionally minimal for the MVP scaffold. Expand with:

- **Tests**: add a `test` job running `pnpm turbo run test` once test suites are written
- **Mobile builds**: EAS Build (`expo/expo-github-action`) triggered on release tags
- **API deploy**: Fly.io (`superfly/flyctl-actions`) on merge to `main`
- **Web deploy**: Vercel GitHub integration (zero-config) or `vercel/actions`
- **E2E**: Playwright / Detox once native smoke tests are added

## Notes

- `concurrency` group cancels stale runs on the same ref (saves CI minutes)
- Turborepo remote cache can be wired up via `TURBO_TOKEN` + `TURBO_TEAM` secrets for faster builds
