# Phase 02 — Accuracy audit of current-state docs

## Goal

Find and fix every claim contradicted by code on `main`. Four lanes run in parallel; file ownership is disjoint.

| Lane | Owns                                                                                         | Verify against                                                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | `README.md`, `docs/project-overview-pdr.md`, `docs/codebase-summary.md`                      | `package.json` scripts, `docker-compose.yml`, workspace tree, `apps/api/src/modules/*`, providers registry, `.env.example` files, extension manifest |
| B    | `docs/architecture/contracts-and-languages.md`, `ai-providers.md`, `data-flow.md`            | `packages/types`, `packages/ai-providers`, `apps/api/src/modules/translate`, `packages/realtime-client`                                              |
| C    | `docs/architecture/authentication.md`, `modules-extension-ci.md`, `docs/deployment-guide.md` | `apps/api/src/modules/auth`, `apps/web/auth.ts`, `.github/workflows/*`, deploy scripts, `apps/extension`                                             |
| D    | `docs/design-guidelines.md`, `docs/brand-mark.md`                                            | `packages/ui/src/tokens.ts`, design specs, `apps/web/src/design/*`, extension icon sources                                                           |

## Rules per lane

- Check file paths, symbol names, env vars, commands, ports, defaults, model names, counts. Every path cited must exist (`test -e`).
- Fix wrong claims in place, in the doc's own voice; delete claims about removed code; add a line for significant shipped behaviour that is missing (check `git log --since=2026-09-15` for features).
- Don't touch recorded measurements unless code changed what they describe.
- Append findings to `reports/audit-lane-<X>.md`: file:line, old claim, evidence, fix.
- `development-journey.md` is out of scope except broken links.

## Validation

Each lane re-runs its path check; lane reports list zero unresolved contradictions (or list them as open questions).
