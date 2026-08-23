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
# The default DATABASE_URL already matches the Postgres in docker-compose.yml.
# Set AUTH_JWT_SECRET (the api refuses to start without it — no auth-off mode):
#   openssl rand -base64 32

# Configure the web environment — AUTH_SECRET signs the session cookie
cp apps/web/.env.example apps/web/.env.local
#   openssl rand -base64 32

# Apply the schema (starts Postgres if it is not already up)
docker compose up -d --wait postgres
pnpm --filter @chatofy/api exec prisma migrate deploy

# Brings up the database, waits for it to be healthy, then starts every app
# that has a dev task: api, web, and the extension's WXT watcher.
pnpm dev

# Or start one app (it expects `docker compose up -d` beforehand)
pnpm --filter @chatofy/api dev
pnpm --filter @chatofy/web dev
```

> Everything that is not a Node app runs in Docker — see `docker-compose.yml`.
> Nothing needs to be installed on the host for it: no Postgres, no Python, no
> `uv`. `web` runs without any env setup.

## Structure

```
chatofy/
├── apps/
│   ├── api/        # NestJS REST + WebSocket API
│   ├── mobile/     # Expo React Native app
│   ├── web/        # Next.js web app
│   └── extension/  # Chrome MV3 meeting translator (see below)
├── packages/
│   ├── ui/           # Design tokens + the shadcn component set (@chatofy/ui,
│   │                 #   components behind @chatofy/ui/react)
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
└── docs/           # Project documentation
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

### Running them

Both sidecars are containers, so there is no setup step — `pnpm dev:all` brings
them up along with the database and then starts web + api:

```bash
pnpm dev:all
```

The first run builds two images and downloads ~1.7GB of weights — most into
`services/local-*/models/`, the Vietnamese voice into a named volume, since it
comes from Hugging Face rather than a release tarball. That takes a while, and
`--wait` holds until both `/healthz` endpoints answer 200 rather than letting
anything talk to a sidecar whose engines are still loading. Later runs reuse the
images and every weight.

Plain `pnpm dev` brings up only the database, which is not enough for
`POST /translate` now that speech defaults to local. It does not stop sidecars a
previous `pnpm dev:all` left running, so translation can keep working after it
until the next time the containers go down — `pnpm dev:stop` stops everything.

The weights live on the host and are bind-mounted in, rather than baked into the
images: they are gitignored, they dwarf the code, and an image carrying them
would be rebuilt for every source edit.

To work on a sidecar's Python directly, `cd services/local-stt && uv sync` still
works — see its README. That path needs a symlink the images already carry:
`sherpa-onnx`'s wheel omits `libonnxruntime.so`, so `import sherpa_onnx` fails
until it is linked to the versioned file `onnxruntime` ships.

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

| Command          | Description                                         |
| ---------------- | --------------------------------------------------- |
| `pnpm dev`       | Database, then every app with a `dev` task          |
| `pnpm dev:all`   | The above plus both speech sidecars                 |
| `pnpm logs`      | Follow the container logs (database and sidecars)   |
| `pnpm dev:stop`  | Stop the containers (`down -v` also wipes the data) |
| `pnpm build`     | Build all packages and apps                         |
| `pnpm lint`      | Lint all workspaces                                 |
| `pnpm typecheck` | Type-check all workspaces                           |
| `pnpm knip`      | Report unused files/exports/deps                    |
| `pnpm format`    | Format all files with Prettier                      |
| `pnpm clean`     | Remove all build artifacts                          |

## Requirements

- Node >= 22 (`.nvmrc` pins 24; run `nvm use`)
- pnpm 11 via Corepack (`corepack enable` — version pinned by `packageManager`)
- Docker with Compose v2, for Postgres and the two speech sidecars

Port 5432 has to be free: the compose file binds it, so a Postgres already
installed on the host has to be stopped (`sudo systemctl disable --now postgresql`)
rather than left running alongside.

## Docs

See [`docs/`](./docs/) for architecture, code standards, and deployment guides.

Colour, type, spacing, elevation, motion and the meaning of each state colour live
in [`docs/design-guidelines.md`](./docs/design-guidelines.md); the values themselves
are in `packages/ui/src/tokens.ts`, shared by web, the extension and mobile.

Components live behind `@chatofy/ui/react` and are shadcn throughout — generated by
the CLI, then re-skinned to those tokens. Web and the extension popup render them.
The meeting overlay does not, and cannot: it draws into a closed shadow root where
a Tailwind class would hand the meeting page the ability to repaint it. That, and
the reason mobile is also excluded, are in the design guidelines.
