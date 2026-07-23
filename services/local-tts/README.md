# local-tts sidecar

Local English speech synthesis over localhost, no cloud call. Wraps
[Kokoro-82M][kokoro] through [sherpa-onnx][sherpa] behind a small FastAPI service
so the NestJS API can synthesize through the normal `TtsProvider` contract.

Standalone `uv` project — not part of the pnpm/turbo workspace, never imported
by the app (same convention as `services/vieneu-tts`).

**English only.** Vietnamese synthesis stays in `services/vieneu-tts`, which
runs a different engine. The API routes by output language, so the split is
invisible to callers.

## Model

| Model                                        | p95 / sentence | RTF   | RAM   | License    |
| -------------------------------------------- | -------------- | ----- | ----- | ---------- |
| Kokoro-82M (`kokoro-en-v0_19`, sid 0 = `af`) | 1.18s          | 0.323 | 619MB | Apache-2.0 |

Measured on this machine, and picked over Piper (faster but judged lower
quality in a user A/B listening test) — see
`plans/reports/tts-en-cpu-benchmark-260718-results-report.md`.

## Setup

```bash
cd services/local-tts
uv sync
uv run python scripts/download_models.py   # one time, idempotent
```

## Run

```bash
uv run --directory services/local-tts uvicorn app:app --port 8003
```

Or start the whole local stack from the repo root with `pnpm dev:all`.

## API

| Route              | Request                                                            | Response                                                                |
| ------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `GET /healthz`     | —                                                                  | `200 {"status":"ok"}` when loaded, `503 {"status":"loading"}` otherwise |
| `POST /synthesize` | JSON `{"text": "…", "language": "en", "voice": "0", "speed": 1.0}` | `200 audio/wav` (PCM16)                                                 |

`language` and `voice` and `speed` are optional. `POST /synthesize` returns
`400` for empty text or a non-English `language`, and `503` before the model
finishes loading.

```bash
curl -s -X POST http://localhost:8003/synthesize \
  -H 'content-type: application/json' \
  -d '{"text":"Hello, this is a test."}' -o out.wav
```

A `voice` that is not an integer, or is outside the model's speaker range,
falls back to the default speaker instead of failing — `/translate` is a public
API and a bad voice should not cost the caller their audio.

## Configuration

| Env                  | Default | Purpose                                                                      |
| -------------------- | ------- | ---------------------------------------------------------------------------- |
| `LOCAL_TTS_THREADS`  | `8`     | Inference threads. 8 (physical cores) beat 16 (hyperthreads) on this machine |
| `LOCAL_TTS_VOICE_ID` | `0`     | Default Kokoro speaker id                                                    |

## Test

```bash
uv run --directory services/local-tts pytest
```

Loads the real model; skip with `LOCAL_TTS_SKIP_MODEL_TESTS=1`.

[kokoro]: https://huggingface.co/hexgrad/Kokoro-82M
[sherpa]: https://github.com/k2-fsa/sherpa-onnx
