---
title: Docs accuracy audit + video call planning docs
status: completed
created: 2026-10-05
branch: docs/audit-and-video-call-planning
mode: auto (parallel-safe phases)
---

# Docs accuracy audit + video call planning docs

## Outcome

Every doc in `docs/`, plus `README.md`, `CLAUDE.md`, `AGENTS.md`, matches the code on `main` (6086bb7c).
The video meeting/call feature is documented as **planned, not implemented**, with a roadmap.

## Constraints

- No code changes. Code comments that cite `docs/system-architecture.md` stay valid because that file survives as an index.
- Keep VitusNguyen's three video docs (commit 9624ff48). Mark them `Proposal — not implemented`, fix false claims about current code, add an **Open decisions** section. Do not pick an SFU.
- English, matching the existing prose voice. Every factual claim must be checkable in source, config, spec, or git.
- Recorded benchmark numbers are history; change them only when code proves them stale.

## Non-goals

Video code; choosing LiveKit/mediasoup/Pion; splitting `development-journey.md`; restyling docs.

## Acceptance criteria

1. Every `docs/**/*.md` ≤ 800 lines except `development-journey.md` (`wc -l`).
2. Zero broken relative links/anchors in `docs/`, `README.md`, `CLAUDE.md`, `AGENTS.md` (link-check script in phase 05).
3. Each audited doc: every claim contradicted by code is fixed; audit log lists file, old claim, evidence, fix.
4. Video docs: no sentence implies the feature exists; status banner present; Open decisions lists SFU, Pion-vs-Node, billing-vs-noncommercial.
5. `docs/project-roadmap.md` and `docs/code-standards.md` exist; CLAUDE.md and AGENTS.md doc trees match `ls docs`.
6. Final report at `reports/docs-audit-report.md` with changes + unresolved questions.

## Phases

| #   | Phase                                                                              | Depends              | Files owned                                          |
| --- | ---------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------- |
| 01  | [Split system-architecture](phase-01-split-system-architecture.md)                 | —                    | `docs/system-architecture.md`, `docs/architecture/*` |
| 02  | [Accuracy audit of current-state docs](phase-02-accuracy-audit-current-docs.md)    | 01                   | see phase (4 parallel lanes, disjoint files)         |
| 03  | [Reconcile video conferencing docs](phase-03-reconcile-video-conferencing-docs.md) | — (parallel with 02) | 3 video docs                                         |
| 04  | [Create roadmap + code standards](phase-04-create-roadmap-and-code-standards.md)   | 02, 03               | `docs/project-roadmap.md`, `docs/code-standards.md`  |
| 05  | [Index sync, link sweep, report](phase-05-index-sync-link-sweep-report.md)         | 04                   | `CLAUDE.md`, `AGENTS.md`, report                     |

## Evidence at planning time

- `grep -riE 'livekit|mediasoup|webrtc|conference|RTCPeerConnection'` over apps/packages/services: no hits.
- system-architecture.md sections (lines): Type Contract 110, Envelope 81, Languages 239, AI Providers 691, Auth 470, Data Flow 329, Module Org 74, Extension 183, CI/CD 37.
- Inbound anchors: `#checklist-adding-a-language-to-the-registry` (README, PDR), `#browser-extension-path` (PDR). Code comments cite the file by name plus section phrases ("LID and audio-based detection", "Bucket layout").
- `CLAUDE.md` lists `code-standards.md`, `project-roadmap.md` — neither exists. `AGENTS.md` lists 5 docs.
