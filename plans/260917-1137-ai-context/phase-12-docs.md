---
phase: 12
title: 'Docs — architecture and codebase summary'
status: complete
priority: P2
effort: '2h'
dependencies: [9, 10, 11]
---

# Phase 12: Docs — architecture and codebase summary

## Goal

Record a user-visible behaviour change and a new API surface in the two evergreen
documents that own them.

## Files to Create / Modify

- Modify: `docs/system-architecture.md`
- Modify: `docs/codebase-summary.md`

## Tasks & Steps

1. `docs/system-architecture.md` never mentions hints across its whole length —
   verified with `grep -ic 'hints' docs/system-architecture.md`, consistent with
   the capability having been built and left unwired. Wiring it is a user-visible
   behaviour change and a new API surface, which is what
   `.claude/rules/documentation-management.md` gates a docs update on. Add:
   - the three `/translation-contexts` routes in the HTTP section, beside
     `/conversations`;
   - the two new Prisma models in the data section;
   - the hints path through `client.session.start` → `TurnSession.hints` →
     `buildContextBlock`, naming that the block is built up to five times per
     turn plus once on the live preview, and that the CLIENT resolves the stored
     id because `session.start` fires per TURN;
   - one line that the glossary is keyed by language, not by role, and why.
2. `docs/codebase-summary.md`: the new API module, the new web hook and
   components, the new extension file, and the new benchmark corpus.
3. Read each document before editing it, update the **smallest owning surface**,
   and link to the schema and the type files rather than restating their
   contents. Do not restate limits that `CONTEXT_LIMITS` owns.
4. Do not touch `docs/design-guidelines.md` — the two design rules and their
   gates are unchanged by this work; the accent and surface budgets were kept,
   not renegotiated.

## Verification

- ```bash
  grep -c 'translation-contexts' docs/system-architecture.md docs/codebase-summary.md
  grep -ic 'hints' docs/system-architecture.md
  ```
  → the first prints a number ≥ 1 for **both** files; the second prints ≥ 3
  (it prints 0 today).
- Every `file:line` and path cited in the new prose resolves:
  ```bash
  grep -oE '(apps|packages|benchmarks)/[A-Za-z0-9_./-]+\.(ts|tsx|mjs|prisma)' \
    docs/system-architecture.md docs/codebase-summary.md \
    | cut -d: -f2- | sort -u | while read -r p; do test -e "$p" || echo "MISSING $p"; done
  ```
  → prints nothing.
- `pnpm lint && pnpm typecheck && pnpm build && pnpm knip`
  → all four exit 0, on the finished branch.

---

## Result — 2026-09-17

`docs/system-architecture.md` gained an _AI Context, and the path a hint takes to
the prompt_ section under Data Flow, the two Prisma models, the
`translation-contexts/` module entry, the three new web files, and the extension's
resolve-once-thread-both note. `docs/codebase-summary.md` gained the three routes,
the store seam, and the benchmarks directory.

- `grep -c 'translation-contexts'` → 7 and 4 (both ≥ 1).
- `grep -ic 'hints' docs/system-architecture.md` → 9, from 0.
- Every `file:line` path cited in the new prose resolves; the check prints nothing.
- `pnpm lint`, `pnpm typecheck`, `pnpm build` and `pnpm knip` all exit 0.

`pnpm knip` was exiting 1 BEFORE this branch — verified by the fact that no files
were deleted and every flagged file is byte-identical to `main`. It was cleaned up
as a separate concern; see the implementation report.
