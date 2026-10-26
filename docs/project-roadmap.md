# Project Roadmap

Where Chatofy stands and what comes next. Dates are merge dates on `main`; nothing here
is a promise of a date that has not happened.

## Shipped

Grouped by area; the PR numbers are the merges that delivered each piece.

| Area                 | What exists today                                                                                                                                                          | PRs                   | Where it is described                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Contracts            | One zod contract per endpoint in `packages/types`, shared by api, web, extension and mobile                                                                                | #38                   | [Contracts, Envelope and Languages](./architecture/contracts-and-languages.md)                                            |
| Translation pipeline | `POST /translate` and the streamed `/ws/translate` turn: STT → MT → TTS, streaming commit, clause-level synthesis, streamed TTS                                            | #41, #140, #167       | [Data Flow](./architecture/data-flow.md)                                                                                  |
| Local speech         | STT and TTS on CPU in two sidecars, vi, en, zh, ElevenLabs kept as the comparison path                                                                                     | #93, #164             | [README](../README.md#local-speech-stack), [AI Provider Abstraction](./architecture/ai-providers.md)                      |
| Realtime mode        | Gemini Live as an alternative to the turn pipeline, full-duplex                                                                                                            | #71, #80              | [AI Provider Abstraction](./architecture/ai-providers.md)                                                                 |
| Display text         | Deterministic Vietnamese ITN and punctuation/case restoration for the transcript                                                                                           | #110, #192–#197       | [AI Provider Abstraction](./architecture/ai-providers.md)                                                                 |
| Speaker attribution  | Per-turn speaker attribution, split turn on speaker change, deferred speaker minting                                                                                       | #99, #173, #179, #181 | [AI Provider Abstraction](./architecture/ai-providers.md#per-turn-speaker-attribution)                                    |
| Languages            | Language registry: every language pair derived from one list (vi, en, zh today)                                                                                            | #180                  | [checklist](./architecture/contracts-and-languages.md#checklist-adding-a-language-to-the-registry)                        |
| Accounts             | Own identity provider in NestJS: email/password, verification, reset, revocation, rotating refresh tokens, Google linking, avatars on R2                                   | #85, #87, #106        | [Authentication](./architecture/authentication.md)                                                                        |
| History              | Stored conversations, search, recordings, turn timestamps                                                                                                                  | #135, #143            | [AI Provider Abstraction](./architecture/ai-providers.md#history-search)                                                  |
| AI Context           | Saved per-user translation contexts (glossary + hints) applied to the prompt                                                                                               | #145                  | [Data Flow](./architecture/data-flow.md)                                                                                  |
| Meeting minutes      | LLM summary, key points, decisions and action items over a stored conversation                                                                                             | #112                  | [AI Provider Abstraction](./architecture/ai-providers.md#meeting-minutes-llm)                                             |
| Video meetings       | Rooms by link, Cloudflare Realtime SFU, vi↔en subtitles and spoken translation per listener, translated chat, end screen with minutes, mobile meeting screens (dev builds) | #207–#212, #255–#258  | [video-conferencing-architecture.md](./video-conferencing-architecture.md)                                                |
| Browser extension    | Chrome MV3 translator for Google Meet, Zoom web and Facebook calls, both directions                                                                                        | outbound merge, #74   | [README](../README.md#browser-extension), [extension path](./architecture/modules-extension-ci.md#browser-extension-path) |
| Web UI and brand     | Production UI, translate page revamp, lotus brand identity, design-rule specs                                                                                              | #83, #97, #168        | [design-guidelines.md](./design-guidelines.md), [brand-mark.md](./brand-mark.md)                                          |
| Delivery             | Self-hosted Docker deploy from `main`, CI gate, alert when `main` goes red, deploy refuses runs not from this repo's `main`                                                | #91, #204, #205       | [deployment-guide.md](./deployment-guide.md)                                                                              |

The measurements and the dead ends behind these are in
[development-journey.md](./development-journey.md).

## In production since 2026-10-23: two-way and auto-detect

Two-way vi↔en conversations and auto-detected source language on `/translate`:
one source picker, a language identifier in the STT sidecar, the turn's
language decided while it is spoken. Enabled on production with
`PROD_LOCAL_STT_LID=on` after an isolated load run, a production replay and a
rehearsed rollback (the switch has since been removed; LID is always on); the
language label shows by 3.3 s at p95 from the start of speech (bar 3.5 s). Chinese is not identified and its pairs
stay one-way.

The mobile app compiles against the new contract only; its translate screen is
planned separately.

Described in [Contracts and Languages](./architecture/contracts-and-languages.md#lid-and-audio-based-detection);
measured in [development-journey.md](./development-journey.md).

## Video meetings

**Live on production behind sign-in; media on Cloudflare Realtime SFU since
2026-10-25.** There is no feature flag: the API refuses to boot without the Cloudflare
Realtime app keys and the web always shows the Conference entry. What exists: rooms
created by `POST /conference` (the link is the access), meeting media on Cloudflare
Realtime SFU driven by the API, a web lobby and call screen, client-side vi↔en
translation fanned out to the room, translated chat, persistence of participants,
turns and messages, and an end screen with minutes on web and mobile. How to run it:
[conference-demo-runbook.md](./conference-demo-runbook.md).

Design and evidence:

- [video-conferencing-architecture.md](./video-conferencing-architecture.md) — target,
  reuse, and the Open decisions
- [architecture/video-conferencing-v2-synthesis.md](./architecture/video-conferencing-v2-synthesis.md) —
  what was decided and measured (#207–#212)
- [database-schema-conference.md](./database-schema-conference.md) — tables
- [technical-risks-mitigation.md](./technical-risks-mitigation.md) — risks

### Still open

| Gate                                                | Issue | Status                                      |
| --------------------------------------------------- | ----- | ------------------------------------------- |
| Network path for media                              | #208  | Done: Cloudflare Realtime SFU (2026-10-25)  |
| Connectivity from ≥ 2 networks (Wi-Fi, 4G)          | #208  | Pending: owner run on production            |
| Translation load with several simultaneous speakers | —     | Not measured; six live sessions server-wide |
| Mobile sign-in through the real auth client         | #210  | Done: PR #255 (2026-10-26)                  |
| End screen with minutes                             | #210  | Done: PR #256 (2026-10-26)                  |
| Mobile device run on Cloudflare                     | #210  | Pending: owner run on a dev build           |
| Billing tables, recording access                    | #212  | Deferred out of thesis scope                |

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
- **Video meetings** — live without a flag; the two-network run (#208) and a
  multi-speaker load run are still open, see [Still open](#still-open).
