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

**Not started.** No conferencing code exists on `main` as of 2026-10-05. The proposal is
in three documents:

- [video-conferencing-architecture.md](./video-conferencing-architecture.md) — target,
  reuse of the current stack, phased plan
- [database-schema-conference.md](./database-schema-conference.md) — proposed tables
- [technical-risks-mitigation.md](./technical-risks-mitigation.md) — risks

### Gate 0 — decide before building

The [open decisions](./video-conferencing-architecture.md#open-decisions) have to be
settled first, because each one changes what the phases below contain:

- the SFU / media server (LiveKit, mediasoup or Pion);
- whether billing tables belong in a non-commercial thesis at all;
- the participant, resolution and frame-rate targets, measured on this project's
  hardware rather than assumed.

### Proposed phases

From [§7 of the proposal](./video-conferencing-architecture.md#7-phased-implementation-roadmap-proposed).
All are **not started**; the week ranges are the proposal's estimates, not a schedule.

| Phase | Goal                                       | Status      |
| ----- | ------------------------------------------ | ----------- |
| 1     | Infrastructure — schema, CRUD, room state  | Not started |
| 2     | Real-time signaling — multi-user WebSocket | Not started |
| 3     | Video basics — transport and grid layout   | Not started |
| 4     | Translation in video — audio and subtitles | Not started |
| 5     | Chat and recording                         | Not started |
| 6     | Minutes and polish                         | Not started |
| 7     | Production hardening                       | Not started |

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
- **Video meetings** — the [open decisions](./video-conferencing-architecture.md#open-decisions),
  plus how media traffic would reach a server when production sits behind a Cloudflare
  Tunnel.
