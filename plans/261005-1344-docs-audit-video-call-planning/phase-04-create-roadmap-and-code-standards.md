# Phase 04 — Create project-roadmap.md and code-standards.md

## project-roadmap.md

- **Shipped**: derived from git history + PDR (translation pipeline, local STT/TTS, auth, history/search, minutes, extension both directions, speaker attribution, deploy). Each item links to the doc that describes it.
- **Next: video meeting/call** — phases taken from video-conferencing-architecture.md §7, marked not started, with the Open decisions as gate 0.
- **Known gaps / open items** collected from phase 02 lane reports.
- No dates invented; only dates evidenced in git.

## code-standards.md

Derived only from enforced sources:

- Lint/format: ESLint configs in `packages/config`, Prettier, commitlint, husky hooks, knip.
- TypeScript: tsconfig strictness; zod contracts in `packages/types` (link `architecture/contracts-and-languages.md`).
- Structure: NestJS module layout in `apps/api/src/modules`, kebab-case file names, file-size guidance from CLAUDE.md.
- Tests: per-app test commands, spec gates (accent budget, token parity, contrast) — link `design-guidelines.md`.
- UI rule: shadcn via `@chatofy/ui/react`.
  Every rule cites the file that enforces it.

## Validation

Each cited path exists; both files ≤ 800 lines.
