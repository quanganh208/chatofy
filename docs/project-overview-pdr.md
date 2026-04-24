# Chatofy — Project Overview PDR

## Product

Realtime Vietnamese ↔ English voice interpreter. User speaks VI, counterpart hears EN (and vice versa), sub-2-second latency.

## Target Users

- Vietnamese professionals + travelers talking with English speakers in real time
- Eventually: tourists, creators, enterprise use cases (post-MVP)

## MVP Scope (6–8 weeks)

- Mobile app (React Native + Expo) only
- Realtime 2-way VI↔EN conversation
- Account (email / OAuth) + translation history
- Generic preset voice for TTS
- Free tier with usage cap (AI cost control)

## Out of MVP (Descoped)

- Browser extension
- Full web app (only landing placeholder now)
- Voice cloning
- Multi-language beyond VI↔EN
- Payment / subscription tiering
- Analytics / metering (beyond basic rate limits)
- Offline mode

## Tech Decisions

| Area          | Choice                                               | Why                                |
| ------------- | ---------------------------------------------------- | ---------------------------------- |
| Monorepo      | Turborepo + pnpm                                     | Simple + caching, startup-fit      |
| Mobile        | Expo SDK 52                                          | Fastest RN iteration, EAS Build    |
| API           | NestJS + Fastify                                     | WS support, TS DI, modular         |
| DB            | Postgres (Prisma)                                    | Relational fit, Prisma DX          |
| Session state | Redis (planned)                                      | Pub/sub for multi-instance scaling |
| AI strategy   | Managed APIs w/ abstraction layer                    | Ship fast, swap to self-host later |
| Auth          | Interface-first (Supabase / BetterAuth / custom TBD) | Defer provider lock-in             |

## Architecture Principles

1. **Interface-first** — every external dependency behind a contract; adapters swap freely.
2. **Shared code in packages** — `@chatofy/types`, `@chatofy/ai-providers`, `@chatofy/config`; extracted early to prevent duplication drift.
3. **YAGNI** — no speculative features; only scaffold what the MVP roadmap needs.
4. **DRY by extraction, not abstraction** — shared code lives in packages; `@chatofy/ui` is a stub until patterns emerge.

## Key Risks

| Risk                                                       | Mitigation                                                |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| OpenAI Realtime Vietnamese quality unverified              | Spike prototype before locking AI pipeline                |
| AI cost at scale (~$0.30/min realtime)                     | Hard rate limit + free tier cap in MVP                    |
| Mobile audio cross-platform bugs (iOS echo, Android perms) | Test on real devices early in feature phase               |
| Auth provider lock-in                                      | Defer — `AuthAdapter` interface lets any provider slot in |

## Milestones

1. **Scaffold** (done) — monorepo + interfaces + empty screens
2. **AI pipeline spike** — verify Realtime API VI↔EN quality
3. **Auth + account** — pick provider, wire AuthAdapter
4. **Mobile audio capture + WS streaming** — end-to-end audio roundtrip (no translation)
5. **Translation E2E** — integrate AI provider; 2-way UI
6. **Transcript history + polish** — storage, history screen, settings
7. **TestFlight + Play Console beta** — internal users, feedback loop

## Success Criteria (MVP)

- End-to-end conversation latency < 2s
- Handle 10-minute conversations without dropouts
- ≥ 70% translation accuracy on everyday conversation (manual eval with native VI speakers)
- Free tier: 10 min/day/user hard cap
- Beta users (internal) can install + run without support
