# Phase 05 — Index sync, link sweep, report

## Steps

1. Update doc trees in `CLAUDE.md` and `AGENTS.md` to match `ls docs docs/architecture` (include video proposal docs, journals dir).
2. Link check: script resolving every relative `](path#anchor)` in `docs/**/*.md`, `README.md`, `CLAUDE.md`, `AGENTS.md` — file exists and anchor matches a GitHub-slugged heading. Zero failures.
3. `wc -l` gate: all ≤ 800 except development-journey.md.
4. `pnpm format` check on changed md (`prettier --check`).
5. Write `reports/docs-audit-report.md`: summary of changes per file, merged lane findings, unresolved questions.
6. Branch `docs/audit-and-video-call-planning`, commit (conventional, no AI trailers), PR only on user approval.
