# Phase 03 — Reconcile video conferencing docs

## Files

`docs/video-conferencing-architecture.md`, `docs/database-schema-conference.md`, `docs/technical-risks-mitigation.md` (author VitusNguyen, 9624ff48).

## Steps

1. Add a status banner at top of each: `Status: Proposal — not implemented. No conferencing code exists on main as of 2026-10-05.` Link to `project-roadmap.md`.
2. Fix claims about the **current** system (the "What's Built" / reuse tables, "already implemented" lines, CAM++ accuracy figures, R2, pg_trgm, Redis usage, auth features). Each must match code or `docs/architecture/*`; otherwise correct or mark as assumption.
3. Rewrite sentences that state video behaviour as present tense fact into proposal tense. Keep the design itself.
4. Add `## Open decisions` (in video-conferencing-architecture.md; others link to it):
   - SFU/media server: LiveKit (self-hosted, Go server + JS/RN SDKs), mediasoup (Node library), Pion (Go library, custom service). Undecided. Trade-off table: fit with NestJS stack, ops cost on prod VM (~3.4 GiB headroom), mobile SDK, effort.
   - Pion references imply a Go service alongside NestJS — flagged, not removed.
   - Billing tables/per-minute costing vs non-commercial thesis — keep marked optional/out of thesis scope pending decision.
   - Stated targets (6 participants, 720p60, VP8) — unverified on prod hardware.
5. Keep each file ≤ 800 lines.

## Validation

`grep -nE "already implemented|✅" ` reviewed line by line; banner present in 3 files.
