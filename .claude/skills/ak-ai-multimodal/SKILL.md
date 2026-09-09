---
name: ak:ai-multimodal
description: Analyze and generate image, audio, video, and document content. Prefers the active model's native vision for image/document understanding; falls back to the npm-latest Multix CLI and live provider catalogs only when native vision is ineligible or a generation/audio/video task needs a configured provider.
user-invocable: true
when_to_use: "Invoke for media generation, transcription, or vision/OCR tasks the active model's native vision cannot handle."
category: ai-ml
keywords: [vision, image, video, audio, Gemini]
license: MIT
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
argument-hint: "[file-path] [prompt]"
---

# AI Multimodal

Process audio, images, videos, and documents with the latest npm release of
`@mrgoonie/multix`. Use the `npx` invocation shown here; do not install or
call a global `multix`. Multix is a fallback route, not the default one —
resolve `## Routing` before running any command below.

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix --version
```

## Routing

Decide the route before invoking Multix. Do not select a route speculatively.

| Task | Preferred route | Route to Multix only when |
|------|------|------|
| Image/document visual understanding (OCR, layout, description, extraction) | **Native vision** — inspect the file directly in this session | Native vision is unavailable/ineligible, the input exceeds its documented limits, or the user explicitly requests Multix or a specific provider |
| Image generation/editing | Multix | A compatible image-generation key (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, or `MINIMAX_API_KEY`) is already configured |
| Video generation | Multix | A compatible video-generation key (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, or `MINIMAX_API_KEY`) is already configured |
| TTS, music, audio transcription | Multix | A compatible audio/music key is already configured (`GEMINI_API_KEY` for transcription, `MINIMAX_API_KEY` for speech/music) |

### 1. Native vision takes precedence

For image/document visual-understanding tasks, read and analyze the file
directly in this session instead of invoking Multix, whenever the active
model is vision-capable and the input fits its documented limits (format,
size, page/frame count). Do not invoke Multix for a task native vision can
already handle.

Fall back to Multix only when the case is one of these, and state which one:

- the active session has no native vision capability;
- the input exceeds native vision's documented limits (e.g. long video, an
  unsupported format, a document beyond its page/size limit);
- the user explicitly asked for Multix or a specific provider/model.

### 2. Multix requires an already-configured, capability-matched credential

Never invoke Multix speculatively or to probe for capability. Before running
any `multix` command:

1. Identify the requested capability: visual analysis/OCR, image generation,
   video generation, or audio/music (transcription, TTS, music).
2. Check only whether the relevant credential is *present*; never print its
   value or the contents of `.env`:

   ```bash
   [ -n "$GEMINI_API_KEY" ] && echo "gemini: configured" || echo "gemini: missing"
   [ -n "$OPENROUTER_API_KEY" ] && echo "openrouter: configured" || echo "openrouter: missing"
   [ -n "$MINIMAX_API_KEY" ] && echo "minimax: configured" || echo "minimax: missing"
   ```

3. Route only to a provider whose configured key actually covers the
   requested capability — a key configured for one modality does not
   authorize a route it cannot fulfill (e.g. an image-only OpenRouter key
   does not authorize a music/speech route). Confirm current per-capability
   coverage against the provider docs in `## Resources`.
4. Never infer, request interactively, generate, or silently probe for a
   missing credential. If the needed key isn't configured, name it from
   `## Setup` and stop.

### 3. No eligible route

When native vision cannot handle the task and no capability-matched
credential is configured, do not guess a route. State the blocker plainly —
no native capability, missing credential, unsupported task, or
provider/task capability mismatch — and name the specific env var or
capability that would unblock it. Never print credential values or `.env`
contents in this diagnostic.

## Setup

Requires Node.js 20+ and provider keys in process env, project `.env`, or
`~/.multix/.env`.

```bash
export GEMINI_API_KEY="your-key"          # https://aistudio.google.com/apikey
export OPENROUTER_API_KEY="your-key"      # optional image/video routing
export MINIMAX_API_KEY="your-key"         # optional MiniMax generation
```

Verify setup:

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix check --verbose
```

When npm networking is enabled, every command resolves npm's `latest` dist-tag
and forces a registry staleness check. Network-restricted sessions must
pre-warm the current release first.

### Backend ownership

- Treat the npm-latest Multix CLI as the runtime contract for covered media
  operations; keep this skill focused on orchestration, provider setup, and
  examples.
- Report missing keys, FFmpeg, provider access, or `multix check` failures as
  environment blockers, not kit-loader failures.
- Track missing capability upstream and refresh the package's latest release
  before retrying. Do not recreate a parallel AgentKit Python backend unless an
  accepted ADR or explicit maintainer decision changes backend ownership.
- The skill intentionally has no managed runtime package: AgentKit requires
  immutable package pins there, while this command contract requires npm latest.
- `## Routing` is a routing/guard fix scoped to this skill, not a Multix
  replacement or a new media backend. It stays compatible with the broader
  first-party `ak vision` CLI work (#1673) — a future `ak vision` route
  slots in as another `## Routing` entry rather than recursing through
  this skill.

## Quick Start

These examples assume `## Routing` already ruled out or bypassed native
vision and confirmed a capability-matched credential.

Analyze media:

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix gemini analyze \
  --files input.png \
  --prompt "Analyze this content" \
  --format markdown \
  --output analysis.md
```

Transcribe audio or video:

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix gemini transcribe \
  --files interview.mp4 \
  --prompt "Generate a transcript with timestamps" \
  --format markdown \
  --output transcript.md
```

Extract structured data:

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix gemini extract \
  --files receipt.png \
  --prompt "Extract merchant, date, total, and line items as JSON" \
  --format json \
  --output receipt.json
```

Convert documents to Markdown:

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix doc convert \
  --input report.pdf \
  --output report.md
```

Generate images after resolving an available model from the live provider catalog:

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix gemini generate \
  --prompt "Studio product photo on white background" \
  --model <verified-model-id> \
  --aspect-ratio 1:1 \
  --size 2K \
  --output product.png
```

Generate images through OpenRouter:

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix openrouter generate \
  --prompt "Editorial campaign key visual" \
  --model <provider-qualified-model-id> \
  --aspect-ratio 4:5 \
  --image-size 2K \
  --output campaign.png
```

Configure OpenRouter fallback models with:

```bash
export OPENROUTER_FALLBACK_MODELS="black-forest-labs/flux.2-flex,recraft-ai/recraft-v3"
```

Generate videos with a currently available provider model:

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix gemini generate-video \
  --prompt "15-second product demo video" \
  --model <verified-model-id> \
  --resolution 1080p \
  --aspect-ratio 16:9 \
  --output demo.mp4
```

Generate with MiniMax:

```bash
# Image
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix minimax generate \
  --prompt "A cyberpunk city" --model <verified-image-model> --aspect-ratio 16:9 --output city.png

# Video
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix minimax generate-video \
  --prompt "A dancer" --model <verified-video-model> --duration <supported-seconds> --resolution <supported-resolution> --output dancer.mp4

# Speech
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix minimax generate-speech \
  --text "Hello world" --model <verified-speech-model> --voice <verified-voice> --output hello.mp3

# Music
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix minimax generate-music \
  --lyrics "La la la\nOh yeah" --prompt "upbeat pop" --model <verified-music-model> --output song.mp3
```

Optimize media before provider uploads:

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix media optimize \
  --input raw-video.mp4 \
  --output optimized-video.mp4 \
  --target-size 20
```

## Provider and Model Resolution

The npm-latest Multix CLI owns command syntax. Provider catalogs own model IDs,
availability, features, limits, pricing, and deprecations. Before generation:

1. Run the relevant npm-latest `multix ... --help` command.
2. Check the provider's current model and pricing documentation.
3. Select an explicit model that supports the requested modality and controls.
4. Record that model in project configuration when reproducibility matters.

Never infer a provider model as "latest," "default," or "recommended" from this skill.

## Failure UX

- **First run / offline**: when npm networking is enabled, `npx --prefer-online` checks the npm registry before each run. For sandboxed or offline sessions, pre-warm with `npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix --version` while network access is available.
- **Node <20**: install Node.js 20+ and rerun the command.
- **Provider key missing**: `multix` reports the missing env var. Export keys in the shell, project `.env`, or `~/.multix/.env`.
- **Environment discovery**: use the locations reported by the resolved CLI; do not infer provider-key search paths from an older backend.
- **Provider API error**: keep the full provider error, redact keys, and retry only after fixing auth, billing, quota, model access, or request parameters.
- **Codex installs**: this skill has no managed runtime package. Codex uses the npm-latest `npx` commands in this file, so pre-warm the npm cache before network-restricted runs.
- **No eligible route**: see `## Routing` §3 — name the blocker (native capability, missing credential, unsupported task, or provider/task mismatch) instead of guessing a route.

If the resolved CLI does not expose a required operation, report the observed gap
and check the upstream issue tracker. Do not revive a parallel local backend.

## References

Load for detailed guidance:

| Topic | File | Description |
|-------|------|-------------|
| Music | `references/music-generation.md` | Stable music brief and review workflow; resolve live provider controls. |
| Audio | `references/audio-processing.md` | Stable transcription and generation workflow; resolve live formats, models, limits, and pricing. |
| Images | `references/vision-understanding.md` | Stable OCR and visual-analysis workflow; resolve live input limits. |
| Image Gen | `references/image-generation.md` | Stable generation/editing workflow; resolve live model capabilities and pricing. |
| Video | `references/video-analysis.md` | Stable video-analysis workflow; resolve live inputs and limits. |
| Video Gen | `references/video-generation.md` | Stable video-generation workflow; resolve live controls and models. |
| MiniMax | `references/minimax-generation.md` | Stable multimodal workflow; resolve the live MiniMax catalog. |

## Limits

Provider limits still apply. Resolve current inline/file-upload size,
retention, duration, context, and output limits before execution. When input or
output exceeds the verified limit, split media with `ffmpeg` or the resolved
Multix media command, process segments, then combine the results.

Transcript output should be Markdown with metadata, chunk status, and timestamped
lines:

```text
[HH:MM:SS -> HH:MM:SS] transcript content
```

## Outputs

Invoke `ak:project-organization` when generated assets need to be grouped into a
project, campaign, report, or deliverable folder.

## Resources

- [multix CLI](https://github.com/mrgoonie/multix-cli)
- [Gemini API Docs](https://ai.google.dev/gemini-api/docs/)
- [Gemini Pricing](https://ai.google.dev/pricing)
- [OpenRouter Image Generation Docs](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
- [OpenRouter Provider Routing](https://openrouter.ai/docs/features/provider-routing)
- [MiniMax API Docs](https://platform.minimax.io/docs/api-reference/api-overview)
- [MiniMax Pricing](https://platform.minimax.io/pricing)
