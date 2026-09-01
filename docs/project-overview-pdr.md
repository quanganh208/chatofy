# Chatofy — Project Overview PDR

## Product

Realtime Vietnamese ↔ English voice interpreter. User speaks VI, counterpart hears EN (and vice versa), sub-2-second latency.

## Target Users

- Vietnamese professionals + travelers talking with English speakers in real time
- Eventually: tourists, creators, enterprise use cases (post-MVP)

## MVP Scope (6–8 weeks)

- Mobile app (React Native + Expo) only
- Realtime 2-way VI↔EN conversation
- Account (email / OAuth). **Translation history is not built**, and the line above
  used to imply it was in scope without saying so. There is one model in the schema —
  `User` — because the tables a history would need were dropped in the migration
  squash rather than left as columns nothing wrote. Nothing on any surface counts,
  charts or lists a past conversation, and the dashboard says so out loud rather than
  showing "0 conversations". It belongs to milestone 6.
- Generic preset voice for TTS
- Free tier with usage cap (AI cost control)
- **Browser extension for meeting calls** (`apps/extension`) — two-way translation
  in a Meet / Zoom web / Facebook call tab, with capture that never stops. What
  the other people say is translated for the user; what the user says is
  translated into the meeting through a page-world microphone patch, off by
  default. Moved into scope from _Out of MVP_ because the constraint that
  kept it out turned out to be acoustic rather than architectural: on one phone with
  one loudspeaker the microphone hears its own output, so capture has to pause while
  a translation plays. Capturing a tab and playing back through an offscreen
  document removes that path structurally. What it does NOT remove is the user's own
  microphone, which the meeting client is still transmitting — see
  [system-architecture](./system-architecture.md#browser-extension-path).

## Out of MVP (Descoped)

- ~~Full web app (only landing placeholder now)~~ — **moved into scope, 2026-08-25.**
  Web is a first-class surface now: a marketing landing at `/`, a post-login hub, the
  translator, preferences and account, in two languages. What changed is not ambition
  but evidence — the translator that mattered was already shipping on web while the
  entry page still said "coming soon", so the placeholder was describing a product
  that no longer existed.
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
2. **Type Contract Standard** — zod schemas in `@chatofy/types` are SINGLE source of truth; TS types are `z.infer`; enforced at compile time (typecheck) and runtime (client parse). Eliminates duplication, powers Swagger generation.
3. **Shared code in packages** — `@chatofy/types` (schemas + domain models), `@chatofy/api-client` (runtime contract validation), `@chatofy/ai-providers`, `@chatofy/config`; extracted early to prevent duplication drift.
4. **YAGNI** — no speculative features; only scaffold what the MVP roadmap needs.
5. **DRY by extraction, not abstraction** — shared code lives in packages; `@chatofy/ui` is a stub until patterns emerge.
6. **Standard API contract** — all responses (success and error) follow a single envelope type (`ApiResponse<T>`); shared across api, mobile, web via @chatofy/api-client for consistency.

## API Design Standards

- **Response envelope**: Every HTTP response wraps in `{ success, data|error, meta: { requestId, timestamp } }` (exception: `/health*` probes stay raw)
- **Error codes**: Stable union (`VALIDATION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_ERROR`) mapped from HTTP status
- **HTTP status semantics**: Real 4xx/5xx codes on the wire (never 200 + success:false) for proper proxy/cache/monitoring behavior
- **Request tracing**: Every request assigned correlation id (inbound `x-request-id` or generated `req_<uuid>`), echoed in response headers and meta
- **Validation**: Standardized via nestjs-zod `ZodValidationPipe`; errors include field-level `details` array
- **OpenAPI docs**: Served at `/docs` in non-production only (gated on `NODE_ENV`; not mounted when `NODE_ENV=production`); all endpoints use `ApiEnvelopeResponse` helper to document the envelope + data type

## Key Risks

| Risk                                                       | Mitigation                                                |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| OpenAI Realtime Vietnamese quality unverified              | Spike prototype before locking AI pipeline                |
| AI cost at scale (~$0.30/min realtime)                     | Hard rate limit + free tier cap in MVP                    |
| Mobile audio cross-platform bugs (iOS echo, Android perms) | Test on real devices early in feature phase               |
| Auth provider lock-in                                      | Defer — `AuthAdapter` interface lets any provider slot in |

## Milestones

1. **Scaffold** (✅ done) — monorepo + interfaces + empty screens
2. **V1 Translation Pipeline** (✅ done) — STT → Gemini translation → TTS, web test UI, no auth
3. **AI pipeline expansion** (planned) — Realtime API VI↔EN quality spike for mobile WS streaming
4. **Auth + account** — pick provider, wire AuthAdapter
5. **Mobile audio capture + WS streaming** — end-to-end audio roundtrip via `/ws/translate` gateway
6. **Translation history + polish** — storage, history screen, settings
7. **TestFlight + Play Console beta** — internal users, feedback loop

## Success Criteria (MVP)

- End-to-end conversation latency < 2s
- Handle 10-minute conversations without dropouts
- ≥ 70% translation accuracy on everyday conversation (manual eval with native VI speakers)
- Free tier: 10 min/day/user hard cap
- Beta users (internal) can install + run without support
