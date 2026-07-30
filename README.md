# Chatofy — Voice Translator Monorepo

Real-time voice translation app. Turborepo + pnpm workspace. Directions: vi→en
and en→vi.

Speech runs **locally on CPU by default** — speech-to-text and text-to-speech
need no API key and make no cloud call. Machine translation is still cloud
Gemini, so the app is not fully offline. See
[Local speech stack](#local-speech-stack).

## Quick Start

```bash
# Install dependencies (also generates the Prisma client via api postinstall)
pnpm install

# Configure the API environment — required for the api to boot
cp apps/api/.env.example apps/api/.env
# then edit apps/api/.env and point DATABASE_URL at a running Postgres

# Start all dev servers
pnpm dev

# Or start individual apps
pnpm --filter @chatofy/api dev
pnpm --filter @chatofy/mobile dev
pnpm --filter @chatofy/web dev
```

> The `api` validates its environment on boot and needs a reachable
> PostgreSQL (`DATABASE_URL`). `web` runs without any env setup.

## Structure

```
chatofy/
├── apps/
│   ├── api/        # NestJS REST + WebSocket API
│   ├── mobile/     # Expo React Native app
│   ├── web/        # Next.js web app
│   └── extension/  # Chrome MV3 meeting translator (see below)
├── packages/
│   ├── ui/           # Shared UI components (stub, reserved)
│   ├── config/       # Shared config (ESLint, TS, etc.)
│   ├── types/        # Shared TypeScript types (zod contracts)
│   ├── api-client/   # Framework-agnostic API client
│   ├── ai-providers/ # STT/MT/TTS provider interfaces + registry
│   └── realtime-client/ # Audio capture, turn-taking policy, ordered playback,
│                        # and the /ws/translate client — shared by web + extension
├── services/
│   ├── local-stt/  # local speech-to-text sidecar (vi + en) — port 8002
│   └── local-tts/  # local speech synthesis sidecar (vi + en) — port 8003
├── benchmarks/
│   ├── stt/        # STT CPU benchmark harness (standalone uv project)
│   ├── tts/        # TTS EN CPU benchmark harness (standalone uv project)
│   └── realtime/   # Turn-taking fixtures, offline VAD reference, metrics analysis
├── docs/           # Project documentation
└── plans/          # Implementation plans
```

## Browser extension

`apps/extension` translates what **other people** say in a browser meeting — Google
Meet, Zoom's web client, or Messenger web — and unlike the mobile and web paths its
capture never stops.

That difference is acoustic rather than clever. On one phone with one loudspeaker the
microphone hears the translation and the app translates itself, so capture has to
pause while a turn plays. An extension captures the tab and plays back through an
offscreen document that is not in the tab's audio graph, so that loop does not exist.

It does not remove the user's own microphone, which the meeting client is still
transmitting: **played through a loudspeaker, the translation is heard by everyone in
the meeting.** The extension measures how much of it comes back rather than pretending
otherwise. Headphones avoid it.

```bash
# Needs the api and both speech sidecars running — see `pnpm dev:all` above.
pnpm --filter extension build

# Then in Chrome: chrome://extensions → Developer mode → Load unpacked
#   → apps/extension/.output/chrome-mv3
```

Open a meeting tab, click the Chatofy icon, pick a direction and press Start. The
overlay shows the transcript and an indicator saying the meeting is being captured;
that indicator cannot be dismissed while capture is running, because the other
participants are not told by their own client.

> Zoom's **desktop app** is not a browser tab and cannot be captured. Join from
> "Join from your browser" instead — the popup says so rather than appearing to do
> nothing.

## Local speech stack

Speech-to-text and text-to-speech run on the CPU of the machine hosting the API.
Two sidecars, split by function — each serves both languages and picks its
engine from the language it is given:

| Service                                                | Port | Job | Models                                  |
| ------------------------------------------------------ | ---- | --- | --------------------------------------- |
| [`services/local-stt`](./services/local-stt/README.md) | 8002 | STT | Zipformer-30M (vi), Moonshine base (en) |
| [`services/local-tts`](./services/local-tts/README.md) | 8003 | TTS | VieNeu v3 Turbo (vi), Kokoro-82M (en)   |

The API picks the backend from `AI_STT_PROVIDER` / `AI_TTS_PROVIDER`, both
defaulting to `local`. There is no per-language exception: the language travels
with each call and the sidecar resolves the engine.

**Translation is still cloud Gemini** — `GEMINI_API_KEY` is required and is the
only remaining network dependency in a translation turn.

> The free tier meters requests **per model**, both per minute and per day, so
> the translate path walks an ordered list on the same key, moving down only
> when a model is out of quota: `gemini-3.5-flash-lite` →
> `gemini-3.1-flash-lite` — 15/min and 500/day each, and measured p50 553ms and
> 557ms per short sentence — → `gemma-4-31b-it` (6.9s; 30/min, 14,400/day, a
> deep but slow reserve).
>
> The request is **streamed** (`generateContentStream`). Not for incremental
> delivery — a one-sentence turn arrives in a single chunk — but for the
> round-trip: 553ms streamed against 820ms blocking on `gemini-3.5-flash-lite`.
> It is also what makes the two flash models a tie, so the leader is a quality
> choice rather than a latency one.
>
> The **per-minute** ceiling is the one a live conversation hits. A 429 carries
> a `retryDelay`, and the provider remembers it: a throttled model is skipped
> until it heals rather than costing every later turn a round-trip that can only
> 429 again. The two flash-lite models together give ~30 turns/minute before
> anything reaches the slow reserve.
>
> `/translate` returns 503 only once the whole list is spent; speech keeps
> working, and the API log carries the underlying 429. The log line names the
> model that answered.

### One-time setup

```bash
# needs `uv`; the download steps fetch model weights (~500MB for STT)
cd services/local-stt && uv sync && uv run python scripts/download_models.py
cd ../local-tts       && uv sync && uv run python scripts/download_models.py
```

The Vietnamese voice downloads itself on the TTS sidecar's first ever run.

Then run everything with `pnpm dev:all`. Plain `pnpm dev` starts only web + api,
which is no longer enough for `POST /translate` now that speech defaults to local.

### Switching back to the cloud

Set `AI_STT_PROVIDER=elevenlabs` and/or `AI_TTS_PROVIDER=elevenlabs` with a
valid `ELEVENLABS_API_KEY`. The ElevenLabs providers are kept precisely so the
two paths can be compared.

### Model licences

| Model              | Licence             | Note                                                                              |
| ------------------ | ------------------- | --------------------------------------------------------------------------------- |
| Zipformer-30M vi   | **CC-BY-NC-ND-4.0** | **Academic / thesis use only.** No commercial use, no distribution of derivatives |
| Moonshine base en  | MIT                 | —                                                                                 |
| Kokoro-82M en      | Apache-2.0          | —                                                                                 |
| VieNeu-TTS v3 (vi) | see upstream        | Check the model card before any commercial use                                    |

If this project is ever commercialized, the Vietnamese STT model must be
replaced — PhoWhisper fits the same `SttProvider` contract, at roughly ~1.3s per
utterance instead of ~0.1s. Measurement details:
[`docs/development-journey.md`](./docs/development-journey.md).

## Commands

| Command          | Description                      |
| ---------------- | -------------------------------- |
| `pnpm dev`       | Start all apps in dev mode       |
| `pnpm build`     | Build all packages and apps      |
| `pnpm lint`      | Lint all workspaces              |
| `pnpm typecheck` | Type-check all workspaces        |
| `pnpm knip`      | Report unused files/exports/deps |
| `pnpm format`    | Format all files with Prettier   |
| `pnpm clean`     | Remove all build artifacts       |

## Requirements

- Node >= 22 (`.nvmrc` pins 24; run `nvm use`)
- pnpm 11 via Corepack (`corepack enable` — version pinned by `packageManager`)
- PostgreSQL for the `api` (set `DATABASE_URL` in `apps/api/.env`)

## Docs

See [`docs/`](./docs/) for architecture, code standards, and deployment guides.
See [`plans/`](./plans/) for implementation plans and progress tracking.
