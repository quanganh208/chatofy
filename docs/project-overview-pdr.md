# Chatofy — Project Overview PDR

## Product

Realtime multilingual voice interpreter. Each person speaks their own language and
hears the other's translated, at sub-2-second latency. Languages are entries in one
registry, so a new language is a data change plus its speech engines, not a
redesign. Shipped today: Vietnamese and English.

## Target Users

- People who need a live conversation across a language barrier; the first users are
  Vietnamese professionals and travelers talking with English speakers
- Eventually: tourists, creators, enterprise use cases (post-MVP)

## MVP Scope (6–8 weeks)

- Mobile app (React Native + Expo) — still a scaffold: screens and the auth client
  are stubs and audio capture is unimplemented. Web and the browser extension are the
  surfaces that ship today
- Realtime 2-way conversation between any two registered languages (VI↔EN today)
- Account (email / OAuth). **Translation history is built** (web only), which is
  milestone 6 below. Seven models in the schema: `User`, `Conversation`,
  `ConversationTurn`, `MeetingMinutes`, `MinutesActionItem`, `TranslationContext`,
  `GlossaryTerm` (`apps/api/prisma/schema.prisma`). A finished conversation
  is saved automatically and `/history` lists, opens, searches and deletes past
  conversations. There is no hub: signing in lands on `/translate`, and what the hub
  uniquely said — whether the microphone and the service will cooperate — is a banner
  there that speaks only when something is definitely wrong.
- Meeting minutes generated from a finished conversation, and a saved **AI Context**
  library (instructions plus a glossary) that steers translation on web and in the
  extension
- Generic preset voice for TTS
- Free tier with usage cap (AI cost control) — **not built yet**; today only per-route
  rate limits exist
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
  [system-architecture](./architecture/modules-extension-ci.md#browser-extension-path).

## Out of MVP (Descoped)

- ~~Full web app (only landing placeholder now)~~ — **moved into scope, 2026-08-25.**
  Web is a first-class surface now: a marketing landing at `/`, the translator,
  history, preferences and account, in two languages. What changed is not ambition
  but evidence — the translator that mattered was already shipping on web while the
  entry page still said "coming soon", so the placeholder was describing a product
  that no longer existed.
- Voice cloning
- Shipping a third language. The architecture is ready for one — see
  [adding a language](./architecture/contracts-and-languages.md#checklist-adding-a-language-to-the-registry)
  — but each language needs its own measured STT and TTS engines first
- Payment / subscription tiering
- Analytics / metering (beyond basic rate limits)
- Offline mode

## Tech Decisions

| Area          | Choice                                                                  | Why                                                |
| ------------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| Monorepo      | Turborepo + pnpm                                                        | Simple + caching, startup-fit                      |
| Mobile        | Expo SDK 55                                                             | Fastest RN iteration, EAS Build                    |
| API           | NestJS + Express                                                        | WS support, TS DI, modular                         |
| DB            | Postgres (Prisma)                                                       | Relational fit, Prisma DX                          |
| Session state | Redis — rotating refresh-token families                                 | One-time-use, revocable refresh tokens             |
| AI strategy   | Local speech sidecars + cloud translation, behind one provider registry | Speech self-hosted on CPU; translation still cloud |
| Auth          | API-issued JWTs behind `AuthAdapter`; Auth.js session on web            | No third-party auth provider lock-in               |

## Architecture Principles

1. **Interface-first** — every external dependency behind a contract; adapters swap freely.
2. **Type Contract Standard** — zod schemas in `@chatofy/types` are SINGLE source of truth; TS types are `z.infer`; enforced at compile time (typecheck) and runtime (client parse). Eliminates duplication, powers Swagger generation.
3. **Shared code in packages** — `@chatofy/types` (schemas + domain models), `@chatofy/api-client` (runtime contract validation), `@chatofy/ai-providers`, `@chatofy/realtime-client`, `@chatofy/i18n`, `@chatofy/ui`, `@chatofy/config`; extracted early to prevent duplication drift.
4. **YAGNI** — no speculative features; only scaffold what the MVP roadmap needs.
5. **DRY by extraction, not abstraction** — shared code lives in packages; `@chatofy/ui` holds the design tokens and the shadcn component set shared by web and the extension popup.
6. **Standard API contract** — all responses (success and error) follow a single envelope type (`ApiResponse<T>`); shared across api, mobile, web via @chatofy/api-client for consistency.

## API Design Standards

- **Response envelope**: Every HTTP response wraps in `{ success, data|error, meta: { requestId, timestamp } }` (exception: `/health*` probes stay raw)
- **Error codes**: Stable union (`errorCodeSchema` in `packages/types/src/http/response.ts`) mapped from HTTP status
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
3. **AI pipeline expansion** (✅ spiked) — Gemini Live speech-to-speech is served on
   `/ws/translate` as a comparison baseline; no client offers it today
4. **Auth + account** (✅ done) — email + Google sign-in, API-issued JWTs behind
   `AuthAdapter`, rotating refresh tokens
5. **Mobile audio capture + WS streaming** — `/ws/translate` streaming is built and used
   by web and the extension; mobile capture is not started
6. **Translation history + polish** — storage, history screen and search delivered
   (web only; the extension and mobile adopt later with no server change). Settings
   were not in this slice.
7. **TestFlight + Play Console beta** — internal users, feedback loop

**Planned, not built:** a video meeting surface with translation in the call. Nothing in
the code implements it yet; see [project-roadmap](./project-roadmap.md).

## Success Criteria (MVP)

- End-to-end conversation latency < 2s
- Handle 10-minute conversations without dropouts
- ≥ 70% translation accuracy on everyday conversation (manual eval with native VI speakers)
- Free tier: 10 min/day/user hard cap
- Beta users (internal) can install + run without support
