# Project Roadmap

Where Chatofy stands and what comes next. Dates are merge dates on `main`; nothing here
is a promise of a date that has not happened.

## Shipped

Grouped by area; the PR numbers are the merges that delivered each piece.

| Area                 | What exists today                                                                                                                        | PRs                   | Where it is described                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Contracts            | One zod contract per endpoint in `packages/types`, shared by api, web, extension and mobile                                              | #38                   | [Contracts, Envelope and Languages](./architecture/contracts-and-languages.md)                                            |
| Translation pipeline | `POST /translate` and the streamed `/ws/translate` turn: STT → MT → TTS, streaming commit, clause-level synthesis, streamed TTS          | #41, #140, #167       | [Data Flow](./architecture/data-flow.md)                                                                                  |
| Local speech         | STT and TTS on CPU in two sidecars, vi + en, ElevenLabs kept as the comparison path                                                      | #93, #164             | [README](../README.md#local-speech-stack), [AI Provider Abstraction](./architecture/ai-providers.md)                      |
| Realtime mode        | Gemini Live as an alternative to the turn pipeline, full-duplex                                                                          | #71, #80              | [AI Provider Abstraction](./architecture/ai-providers.md)                                                                 |
| Display text         | Deterministic Vietnamese ITN and punctuation/case restoration for the transcript                                                         | #110, #192–#197       | [AI Provider Abstraction](./architecture/ai-providers.md)                                                                 |
| Speaker attribution  | Per-turn speaker attribution, split turn on speaker change, deferred speaker minting                                                     | #99, #173, #179, #181 | [AI Provider Abstraction](./architecture/ai-providers.md#per-turn-speaker-attribution)                                    |
| Languages            | Language registry: every direction derived from one list (vi, en today)                                                                  | #180                  | [checklist](./architecture/contracts-and-languages.md#checklist-adding-a-language-to-the-registry)                        |
| Accounts             | Own identity provider in NestJS: email/password, verification, reset, revocation, rotating refresh tokens, Google linking, avatars on R2 | #85, #87, #106        | [Authentication](./architecture/authentication.md)                                                                        |
| History              | Stored conversations, search, recordings, turn timestamps                                                                                | #135, #143            | [AI Provider Abstraction](./architecture/ai-providers.md#history-search)                                                  |
| AI Context           | Saved per-user translation contexts (glossary + hints) applied to the prompt                                                             | #145                  | [Data Flow](./architecture/data-flow.md)                                                                                  |
| Meeting minutes      | LLM summary, key points, decisions and action items over a stored conversation                                                           | #112                  | [AI Provider Abstraction](./architecture/ai-providers.md#meeting-minutes-llm)                                             |
| Browser extension    | Chrome MV3 translator for Google Meet, Zoom web and Facebook calls, both directions                                                      | outbound merge, #74   | [README](../README.md#browser-extension), [extension path](./architecture/modules-extension-ci.md#browser-extension-path) |
| Web UI and brand     | Production UI, translate page revamp, lotus brand identity, design-rule specs                                                            | #83, #97, #168        | [design-guidelines.md](./design-guidelines.md), [brand-mark.md](./brand-mark.md)                                          |
| Delivery             | Self-hosted Docker deploy from `main`, CI gate, alert when `main` goes red, deploy refuses runs not from this repo's `main`              | #91, #204, #205       | [deployment-guide.md](./deployment-guide.md)                                                                              |

The measurements and the dead ends behind these are in
[development-journey.md](./development-journey.md).

## Next: video meetings

**PoC on `video-conferencing` branch; not yet on `main`.** Design gates complete as of
2026-10-07 (Issues #207–#212). The three design documents are:

- [video-conferencing-architecture.md](./video-conferencing-architecture.md) — target,
  reuse, open decisions (all resolved or deferred)
- [database-schema-conference.md](./database-schema-conference.md) — Prisma models
- [technical-risks-mitigation.md](./technical-risks-mitigation.md) — risks (updated with measurements)

### Gate 0 — design decisions

| Decision                                | Status                                                          |
| --------------------------------------- | --------------------------------------------------------------- |
| SFU / media server                      | **Resolved: mediasoup** (#207)                                  |
| Network path for media                  | **Resolved: Path A** (public port + coturn) (#208)              |
| Translation audio path                  | **Resolved: client-side capture** (#209)                        |
| Client support (web / mobile)           | **Resolved** (#210) — mobile real-device test pending (#210 AC) |
| Capacity targets on production hardware | **Resolved: #211** (measured 2026-10-11 — 6p × 720p60 viable)   |
| Billing tables                          | **Deferred out of thesis scope** (#212)                         |
| Speaker embedding persistence           | **Deferred** (#212)                                             |
| Recording access policy                 | **Deferred** (#212)                                             |
| System design v2 review                 | **Pending: @quanganh208 review** (#212 AC)                      |

### Implementation phases

Phase 1 is ready to start once @quanganh208 approves the design. Implementation issues
are listed in [#212](https://github.com/VitusNguyen/chatofy/issues/212).

| Phase | Goal                                       | Status                            |
| ----- | ------------------------------------------ | --------------------------------- |
| 1     | Infrastructure — schema, CRUD, room state  | Ready (PoC code on branch)        |
| 2     | Real-time signaling — multi-user WebSocket | Ready (PoC code on branch)        |
| 3     | Video basics — transport and grid layout   | Not started                       |
| 4     | Translation in video — audio and subtitles | Designed (#209), not wired        |
| 5     | Chat and recording                         | Chat designed; recording deferred |
| 6     | Minutes and polish                         | Not started                       |
| 7     | Production hardening                       | Not started                       |

## Known gaps

Found by the 2026-10-05 docs audit and left open because each needs a decision or a
code change, not a doc edit.

- **Code comments that still carry old facts.** Docs were corrected, the comments were
  not (a docs-only pass): contrast figures in `packages/ui/src/tokens.ts` and
  `apps/web/src/design/contrast-floors.spec.ts`; the 1 MB limit in
  `narrow-body-limits.ts`; "three of four" mail purposes in `mail-sender.interface.ts`;
  the 0.38–0.58 "entirely below 0.50" line in `auto-attribution.ts`; the
  `docker-compose.prod.yml` header saying missing values expand to empty; the R2 boot
  warning in `apps/api/src/main.ts` naming avatars only.
- **Speaker-attribution seed-perturbation minimum** — the architecture doc says 96/94
  exact, `auto-attribution.ts` says 90/89. Needs a re-run to settle.
- **Video meetings — production gates** — open decisions resolved (#207–#212); remaining
  gate: mobile real-device (#210), and @quanganh208 design
  review (#212). Implementation starts after the review.
