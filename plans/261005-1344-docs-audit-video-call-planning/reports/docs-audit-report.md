# Docs audit report — 2026-10-05

Branch `docs/audit-and-video-call-planning`, against `main` at 6086bb7c. Docs only; no code changed.

## Result

- About 210 claims contradicted by code were fixed across 15 docs. Per-finding logs: `audit-lane-A.md` … `audit-lane-D.md`, `audit-video-docs.md`.
- `system-architecture.md` (2217 lines) is now a 25-line index. Its content moved verbatim into `docs/architecture/` (5 files, 457/719/~480/354/~300 lines), then those files were audited.
- New docs: `project-roadmap.md` (what has shipped, the video call phases, known gaps) and `code-standards.md` (only rules that some config or spec enforces, each citing its file).
- The docs trees in `CLAUDE.md` and `AGENTS.md` now match `ls docs`.
- Video docs: each opens with a "Proposal — not implemented" banner, and claims about the current system are corrected (78 fixes). An **Open decisions** section covers the SFU choice, Pion meaning a Go service, billing, unverified targets, stored embeddings and recording access. The teammate's design is kept.

## Gates

| Gate                                                                                            | Result   |
| ----------------------------------------------------------------------------------------------- | -------- |
| Every doc ≤ 800 lines except development-journey.md                                             | pass     |
| Relative links + anchors (docs, README, CLAUDE, AGENTS)                                         | 0 broken |
| prettier --check                                                                                | pass     |
| Video proposal banner in 3 files; current-state docs mention video only as "planned, not built" | pass     |

## Notable corrections

- README: `pnpm --filter @chatofy/api …` matched no package and exited 0, so the migrate step silently did nothing. The real names are `api` and `web`. Redis was missing from the setup steps and the ports table.
- README/summary: outbound translation does not use the `audioCapture` permission (the manifest deliberately leaves it out). The API runs on Express, not Fastify. The schema has 7 models.
- Architecture: OpenAI-compatible translation hosts and the `deepseek` production setting are now documented. Speaker-attribution numbers are updated to the 0.50/0.45 thresholds. The REST body, the per-turn language-plan 503 and the live-preview trigger are corrected. A new "LID and audio-based detection" section fills the gap a code comment pointed to.
- Deployment: the language-registry migrations are no longer listed as pending. Lane C confirmed this with a read-only query of the production `_prisma_migrations` table. `--env-file` is now required on every compose command.
- Design: contrast figures measured on the old palette were re-measured on the current one. One conclusion flipped: `borderControl` on notice backgrounds now passes 3:1. The component inventory and both budget gates are corrected.

## Unresolved questions

1. Some code comments still carry stale facts; the list is under "Known gaps" in `project-roadmap.md`. Should a follow-up PR fix them?
2. Seed-perturbation minimum: the doc says 96/94, `auto-attribution.ts` says 90/89. This needs a re-run.
3. The PDR risk row names "OpenAI Realtime", which the code never used (the realtime path is Gemini Live). Keep it as a record of what was planned, or rewrite it?
4. The LiveKit/mediasoup/Pion trade-off table is based on general knowledge. Upstream docs and memory footprint on the production VM are not verified.
5. How media traffic would reach an SFU while production sits behind a Cloudflare Tunnel is undecided.
6. Should the teammate who wrote the video docs review these edits before the merge?
