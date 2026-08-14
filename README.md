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
│   ├── mos/        # Blinded mini-MOS listening panel (standalone uv project)
│   └── realtime/   # Turn-taking fixtures, offline VAD reference, metrics analysis
├── docs/           # Project documentation
└── plans/          # Implementation plans
```

## Browser extension

`apps/extension` translates a browser meeting — Google Meet, Zoom's web client, or a
Facebook call — in **both directions**, and unlike the mobile and web paths its capture
never stops.

Inbound is what the other people say, translated into the user's language and played
to them. That difference from the phone is acoustic rather than clever: on one phone
with one loudspeaker the microphone hears the translation and the app translates
itself, so capture has to pause while a turn plays. An extension captures the tab and
plays back through an offscreen document that is not in the tab's audio graph, so that
loop does not exist.

Outbound is the user's own speech, translated the other way and spoken **into the
meeting**, so the other participants hear it. It is off by default and has a cost worth
knowing before switching it on — see below.

A Facebook call opens in a window with no toolbar, so there is no extension icon to
click there. Start it with the keyboard shortcut (`Alt+Shift+C` by default, rebindable
at `chrome://extensions/shortcuts`) or by right-clicking the call and choosing Chatofy;
after that the overlay's own Start/Stop button works for the rest of the call.

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

Until you start, the overlay is a small pill in the corner — click it to open the
panel, and the panel's own ▾ to put it back. Starting a capture opens the panel
for you; collapsing it again while the capture runs leaves a red pill that pulses
and reads **Recording**, so getting the transcript out of the way is never a way
to make a recording look like it is not happening.

### Turning it off

The popup's **Runs on** section lists all three platforms with a switch each,
whatever tab you opened it over. Unticking one means Chatofy does nothing there:

- no pill and no panel — the overlay is removed from the page, not hidden
- no context-menu entry on that platform
- the icon, `Alt+Shift+C` and right-click → Chatofy will not start a capture

**Except that it cannot hide a recording in progress.** Switching off a platform
that is currently being captured stops that capture; the indicator goes away
because the recording ended, never because a setting hid it.

To revoke the extension's access to a site outright — beyond anything Chatofy
itself controls — use Chrome's own **Site access** under
`chrome://extensions` → Chatofy → Details.

> Zoom's **desktop app** is not a browser tab and cannot be captured. Join from
> "Join from your browser" instead — the popup says so rather than appearing to do
> nothing.

### Translating what you say

Tick **"Also translate what I say"** in the popup or the overlay. Then:

- While a capture is running the other participants hear a **synthetic voice** speaking
  the translation, and **only** that. The user's own voice is held out of the meeting
  for the length of the session rather than mixed underneath — the two are the same
  person several seconds apart, and one under the other is not something anyone can
  follow. Stop the capture and their real voice goes straight back.
  - So the meeting hears **nothing while the user is speaking**, then the translation.
    That is the trade this makes: it costs the cue of who is talking, which mixing the
    two was there to keep.
  - The hold is a **lease the extension renews**, not a switch it sets. If the
    extension is reloaded, crashes, or is killed by Chrome, the page gives the
    microphone back on its own within a few seconds — a held-shut microphone in a live
    meeting must never be able to outlive whatever was holding it.
- **The meeting page has to be reloaded** the first time it is switched on. The patch
  that carries the voice is installed only while the feature is on, and a page already
  open cannot be given it retroactively. Reloading also revokes the `activeTab` grant
  that `tabCapture` needs, so capture has to be started again with the keyboard
  shortcut or the context menu — the overlay says both steps.
- **Muting in the meeting client stops the translation too**, and stops the microphone
  being captured at all. That is deliberate: a user who mutes to say something private
  must not have it translated and handed to the page.
- Until the page carries the patch, the overlay says the translation is **for the user
  only**. On a loudspeaker their open microphone still carries it to the meeting, which
  is the same caveat the inbound direction has always had. Headphones avoid it.

It needs two permissions the inbound direction does not:

| Permission     | Why                                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `audioCapture` | An offscreen document has no UI, so it cannot show Chrome's microphone prompt. Without this the microphone is refused outright rather than asked about.                                                                                                                  |
| `scripting`    | Registers the page-world patch, and **only while the feature is on**. Declaring it in the manifest instead would need no permission — and would replace the microphone of everyone who installs the extension, on every meeting they open, whether or not they use this. |

The patch runs in the meeting page's own world, because the outgoing microphone belongs
to the page and cannot be reached from anywhere else. That world **cannot hold a
secret** — measured, not assumed: `apps/extension/e2e/run.mjs` shows a script in the
page's own `<head>` receiving anything sent there. So nothing confidential is sent, the
extension trusts nothing the page reports, and turn order is decided in the offscreen
document, which asks the page nothing.

```bash
pnpm --filter extension test        # unit
pnpm --filter extension test:e2e    # loads the built extension into Chromium
```

The end-to-end run checks the things fakes cannot: that the composed track carries
audio rather than silence, that a translated sentence comes out of the track the
meeting transmits, that muting is reported, and that a user who never enables the
feature is not detectable as a Chatofy user. It prints what it still cannot answer.

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

**Translation is still cloud Gemini** — a Gemini key is required and is the
only remaining network dependency in a translation turn.

> The free tier meters requests **per project per model**, both per minute and
> per day, so the translate path walks an ordered list of models, moving down
> only when the current one is out of quota under every key:
> `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` — 15/min and 500/day each,
> and measured p50 553ms and 557ms per short sentence — → `gemma-4-31b-it`
> (6.9s; 30/min, 14,400/day, a deep but slow reserve).
>
> Because the meter counts the **project** and not the key, `GEMINI_API_KEY`
> also accepts several keys separated by commas, and the provider rotates
> across them with one warm client each — multiplying the ceiling when (and
> only when) the keys come from different Google Cloud projects. See
> `apps/api/.env.example` for the conditions that make extra keys worth having.
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

Colour, type, spacing and the meaning of each state colour live in
[`docs/design-guidelines.md`](./docs/design-guidelines.md); the values themselves
are in `packages/ui`, shared by web, the extension and mobile.
