---
phase: 4
title: Cleanup and verify
status: completed
effort: M
priority: P2
dependencies:
  - 2
  - 3
---

# Phase 4: Cleanup and verify

## Overview

Execute the verified DELETE list from Phase 2: remove dead files/exports/deps, then prove nothing broke with the full CI-equivalent gate.

## Requirements

- Functional: only items with DELETE verdict removed; nothing else touched.
- Non-functional: no behavior change; commits focused (conventional format, no AI references).

## Related Code Files

- Delete: per Phase 2 triage table (files/exports)
- Modify: per-workspace `package.json` files (removed deps, e.g. `ioredis` if confirmed), `pnpm-lock.yaml` (via `pnpm install` after dep removal)

## Implementation Steps

1. Delete dead files from the DELETE list.
2. Remove dead exports (delete the symbol, or drop `export` keyword if used internally).
3. Remove dead deps: edit `package.json`, run `pnpm install` to sync lockfile.
4. Gate: `pnpm lint && pnpm typecheck && pnpm build` — all green. Do NOT use api jest as gate (fragile, not in CI). `packages/api-client` has vitest — run it if any api-client code changed.
5. Re-run `pnpm knip` → 0 findings beyond declared ignores.
6. If a deletion breaks the gate → restore that item, mark as KEEP with evidence, update `knip.json`, re-run gate.

## Success Criteria

- [ ] Entire DELETE list executed
- [ ] `pnpm lint && pnpm typecheck && pnpm build` green
- [ ] `pnpm knip` exits 0 (ignores only)
- [ ] api-client vitest green if that package changed
- [ ] `git diff` contains only deletions + config/lockfile — no logic edits

## Risk Assessment

- A "dead" export used only by fragile api jest specs → typecheck will still catch compile use; if only test files reference it, tests count as usage → KEEP or delete test too (judgment: prefer keeping tested code, flag to user).
- Rollback: single revert; everything in git.
