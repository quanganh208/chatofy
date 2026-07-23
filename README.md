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
│   └── web/        # Next.js web app
├── packages/
│   ├── ui/           # Shared UI components (stub, reserved)
│   ├── config/       # Shared config (ESLint, TS, etc.)
│   ├── types/        # Shared TypeScript types (zod contracts)
│   ├── api-client/   # Framework-agnostic API client
│   └── ai-providers/ # STT/MT/TTS provider interfaces + registry
├── services/
│   ├── local-stt/  # sherpa-onnx STT sidecar (vi + en) — port 8002
│   ├── local-tts/  # sherpa-onnx Kokoro TTS sidecar (en) — port 8003
│   └── vieneu-tts/ # Python VieNeu-TTS sidecar (Vietnamese speech, en→vi) — port 8001
├── benchmarks/
│   ├── stt/        # STT CPU benchmark harness (standalone uv project)
│   └── tts/        # TTS EN CPU benchmark harness (standalone uv project)
├── docs/           # Project documentation
└── plans/          # Implementation plans
```

## Local speech stack

Speech-to-text and text-to-speech run on the CPU of the machine hosting the API.
Three sidecars, split by runtime and function:

| Service                                                  | Port | Job          | Model                                   |
| -------------------------------------------------------- | ---- | ------------ | --------------------------------------- |
| [`services/local-stt`](./services/local-stt/README.md)   | 8002 | STT, vi + en | Zipformer-30M (vi), Moonshine base (en) |
| [`services/local-tts`](./services/local-tts/README.md)   | 8003 | TTS, en      | Kokoro-82M                              |
| [`services/vieneu-tts`](./services/vieneu-tts/README.md) | 8001 | TTS, vi      | VieNeu v3 Turbo                         |

The API picks the backend from `AI_STT_PROVIDER` / `AI_TTS_PROVIDER` (both
default to `local`) and routes TTS by output language, so English goes to Kokoro
and Vietnamese to VieNeu automatically.

**Translation is still cloud Gemini** — `GEMINI_API_KEY` is required and is the
only remaining network dependency in a translation turn.

### One-time setup

```bash
# needs `uv`; each download step fetches model weights (~500MB for STT)
cd services/local-stt  && uv sync && uv run python scripts/download_models.py
cd ../local-tts        && uv sync && uv run python scripts/download_models.py
cd ../vieneu-tts       && uv sync
```

Then run everything with `pnpm dev:all`. Plain `pnpm dev` starts only web + api,
which is no longer enough for `POST /translate` now that speech defaults to local.

### Switching back to the cloud

Set `AI_STT_PROVIDER=elevenlabs` and/or `AI_TTS_PROVIDER=elevenlabs` with a
valid `ELEVENLABS_API_KEY`. The ElevenLabs providers are kept precisely so the
two paths can be compared.

### Model licences

| Model             | Licence             | Note                                                                              |
| ----------------- | ------------------- | --------------------------------------------------------------------------------- |
| Zipformer-30M vi  | **CC-BY-NC-ND-4.0** | **Academic / thesis use only.** No commercial use, no distribution of derivatives |
| Moonshine base en | MIT                 | —                                                                                 |
| Kokoro-82M en     | Apache-2.0          | —                                                                                 |

If this project is ever commercialized, the Vietnamese STT model must be
replaced — PhoWhisper fits the same `SttProvider` contract, at roughly ~1.3s per
utterance instead of ~0.1s. Measurement details:
[`plans/reports/stt-cpu-benchmark-260718-results-report.md`](./plans/reports/stt-cpu-benchmark-260718-results-report.md).

## en→vi Vietnamese TTS (VieNeu sidecar)

The en→vi direction synthesizes Vietnamese speech with a local VieNeu-TTS Python
sidecar (`services/vieneu-tts`, CPU/ONNX). The API routes TTS by output language:
English → ElevenLabs, Vietnamese → VieNeu (`VIENEU_TTS_URL`, `VIENEU_TTS_VOICE`).

```bash
# One-time: install the sidecar (needs `uv`; first run downloads the model)
cd services/vieneu-tts && uv sync

# Run everything (web + api + sidecar) together:
pnpm dev:all
# …or run the sidecar on its own:
uv run --directory services/vieneu-tts uvicorn app:app --port 8001
```

See [`services/vieneu-tts/README.md`](./services/vieneu-tts/README.md) for details.

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
