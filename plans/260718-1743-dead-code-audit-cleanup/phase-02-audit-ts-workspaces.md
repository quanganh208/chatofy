---
phase: 2
title: Audit TS workspaces
status: completed
effort: M
priority: P2
dependencies:
  - 1
---

# Phase 2: Audit TS workspaces

## Overview

Run knip, triage every finding (unused files / unused exports / unused deps) into: DELETE (verified dead), KEEP (intentional stub → add ignore), or ASK (ambiguous). Produce a verified deletion list — no deletions in this phase.

## Requirements

- Functional: every knip finding gets a verdict with evidence (grep result or design doc reference).
- Non-functional: zero unverified deletions carried into Phase 4.

## Architecture

Triage protocol per finding category:

1. **Unused file** → grep basename + exported symbol names repo-wide (incl. string references for DI tokens, dynamic imports, jest configs, `.env.example` mentions). Dead only if zero hits outside itself.
2. **Unused export** → grep symbol name repo-wide. For `apps/api`: check NestJS module `providers`/`exports` arrays and custom token symbols (`AUTH_ADAPTER`, `USER_REPOSITORY`, `SESSION_STORE`, `TRANSLATOR_SERVICE`). For `packages/ai-providers`: check `ProviderRegistry` registrations in `register-default-providers.ts` — registry resolves by string name, invisible to knip.
3. **Unused dependency** → grep package name in source + configs (eslint presets, jest transforms, tsconfig paths load deps without imports). Known suspect: `ioredis` in `apps/api` (docs say Redis "future") — if unreferenced, verdict DELETE dep + drop from docs env notes.

## Related Code Files

- Read-only phase. Outputs triage table into the phase report.
- Create: `plans/reports/dead-code-audit-260718-ts-triage-report.md` (findings table: item | category | workspace | verdict | evidence)

## Implementation Steps

1. `pnpm knip` → capture full output.
2. Triage per protocol above; record verdict + one-line evidence per finding.
3. KEEP verdicts → append to `knip.json` ignores (with locked-decision traceability).
4. ASK verdicts → surface to user via AskUserQuestion before Phase 4; do not default to delete.
5. Re-run `pnpm knip` → remaining findings must all be verdict DELETE.

## Success Criteria

- [ ] Triage table covers 100% of knip findings, each with evidence
- [ ] `ioredis` has an explicit verdict
- [ ] ASK items resolved by user (or moved to KEEP)
- [ ] Post-triage `pnpm knip` output == DELETE list exactly

## Risk Assessment

- DI/registry string-resolution is the false-positive engine — the grep protocol (incl. string literals) is mandatory, not optional.
- Type-only exports in `packages/types` consumed via `import type` — knip handles these, but verify zod schema exports used only at runtime-boundary validation.
