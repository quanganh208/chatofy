# vieneu-tts sidecar

Local HTTP service wrapping [VieNeu-TTS](https://github.com/pnnbao97/VieNeu-TTS)
(v3 Turbo, ONNX/CPU, torch-free) so the NestJS API can synthesize **Vietnamese**
speech over localhost for the en→vi translation direction.

Not part of the pnpm/turbo workspace — it's a standalone `uv` Python project.

## Requirements

- [`uv`](https://astral.sh/uv) (manages Python 3.11 + deps)
- First run downloads the VieNeu model from Hugging Face (~hundreds MB, cached
  in your user HF cache and reused across projects).

## Setup

```bash
cd services/vieneu-tts
uv sync
```

## Run

```bash
uv run uvicorn app:app --port 8001
```

- Cold-start loads the model once (~8s warm cache); requests after that are fast.
- Config via env:
  - `PORT` (uvicorn flag) — default 8001 by convention (API expects `VIENEU_TTS_URL`).
  - `VIENEU_VOICE` — default preset voice (default `Phạm Tuyên`).
  - `VIENEU_THREADS` — ONNX Runtime threads (default `8` = physical cores; beat 16 in benchmarks).

## Endpoints

- `GET /healthz` → `{"status":"ok"}` (200) once the model is loaded, else 503.
- `GET /voices` → `{"default":..., "voices":[... 14 presets ...]}`.
- `POST /synthesize` `{"text": "...", "voice"?: "Phạm Tuyên"}` → `audio/wav` (48 kHz, PCM16).

## Concurrency

The CPU engine is a single warm resource; a lock **serializes** inference. Fine
for local dev (single user). Not sized for concurrent production load — see the
integration plan for the streaming/production follow-up.

## Test

```bash
uv run pytest            # integration: loads the real model
VIENEU_SKIP_MODEL_TESTS=1 uv run pytest   # skip model-loading tests
```
