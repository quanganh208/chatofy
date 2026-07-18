# Brainstorm Report: Dead-Code Audit & Cleanup

Date: 2026-07-18 | Mode: markdown only (no --html/--wiki) | Status: design approved by user

## Problem Statement

User wants full-project check for redundant/unused code (files, exports, dependencies) across the Turborepo monorepo + Python sidecar, then removal of confirmed dead code.

## Scout Findings

- ~146 TS/TSX files across 7 workspaces: api 63, mobile 25, ai-providers 19, web 19, types 14, api-client 5, ui 1. Python sidecar: 2 files (`app.py`, `test_app.py`).
- No dead-code tooling exists (no knip/ts-prune/depcheck). CI = lint + typecheck + build only; no tests in CI (api jest fragile — not usable as gate).
- Intentional interface-first stubs exist: `packages/ui` (reserved), `RealtimeProvider`, `IAudioRecorder`/`IAudioPlayer`, `NoopAuthAdapter`, `NoopTranslatorService`, `PrismaUserRepository` stub.
- Suspected unused dep: `ioredis` (docs say Redis "future").
- Docs drift: README structure omits `packages/ai-providers` and `packages/api-client`.
- False-positive risk zones: NestJS DI (token/registry resolution, no direct imports), Next.js App Router file conventions, Expo Router route files.

## User Decisions (captured via AskUserQuestion)

1. Output: **audit + delete** confirmed dead code in same effort (via plan → implement).
2. Scope: TS files/exports + dependencies + Python sidecar + fix docs drift. All four.
3. Intentional stubs: **keep all**, mark as knip ignores so they never re-report.
4. Tooling: **install knip as devDependency** + `knip.json` committed (repeatable, CI-ready).

## Approaches Evaluated

| Approach                                         | Pros                                                           | Cons                                                                       | Verdict             |
| ------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------- |
| A. Tool-driven (knip)                            | Repeatable, one pass covers files+exports+deps, monorepo-aware | Needs config tuning for NestJS DI / Expo Router; reports intentional stubs | Base layer          |
| B. Manual agent audit per workspace              | Context-aware (knows stubs intentional), no new dep            | Token-heavy, not repeatable, misses stray exports at 146-file scale        | Rejected as primary |
| C. Hybrid: knip + manual triage of every finding | Tool coverage + human judgment on DI false-positives           | Slightly more steps                                                        | **Chosen**          |

## Agreed Design (5 phases)

1. **Setup:** knip devDep at root + `knip.json` (entries: api `main.ts`, Next plugin, Expo `app/**`, library packages `src/index.ts`); ignores for intentional stubs; `pnpm knip` script.
2. **Audit TS:** run knip → findings (unused files / exports / deps incl. ioredis). Manually verify EVERY finding via grep before deletion — DI/registry resolution is the false-positive source.
3. **Audit Python:** one-shot `uv run --with ruff ruff check --select F401,F841` + manual read of `app.py`. No permanent Python tooling.
4. **Cleanup + verify:** delete confirmed items; gate = `pnpm lint && pnpm typecheck && pnpm build` (matches CI; jest not used as gate). Re-run knip → target 0 findings beyond declared ignores.
5. **Docs:** fix README structure (add ai-providers, api-client); update `docs/codebase-summary.md` where cleanup changes reality.

## Risks & Mitigation

- **NestJS DI false-positives** → mandatory grep verification per finding before delete.
- **Expo/Next convention files flagged** → correct entry config in knip.json first; treat flags on route/layout files as config bugs, not dead code.
- Everything recoverable via git history.

## Success Criteria

- knip runs clean (0 findings beyond documented ignores).
- lint + typecheck + build green after deletions.
- No behavior change (no runtime code paths altered, only dead code removed).
- README/docs match actual workspace layout.

## Out of Scope

Refactors, architecture changes, deleting intentional stubs, adding tests, CI gate for knip (user picked "audit + delete", not "report + gate CI" — can add later).

## Next Steps

Hand off to `/ck:plan` with this report as context.

## Unresolved Questions

None — all decision points captured above.
