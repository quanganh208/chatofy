# local-tts sidecar

Local speech synthesis over localhost, no cloud call. A small FastAPI service so
the NestJS API can synthesize through the normal `TtsProvider` contract.

Standalone `uv` project — not part of the pnpm/turbo workspace, never imported
by the app (same convention as the benchmark harnesses).

**Both output languages.** The engine is chosen from the `language` field, so
the two runtimes below are invisible to callers.

## Models

| Language | Model                          | Runtime               | Latency        | License      |
| -------- | ------------------------------ | --------------------- | -------------- | ------------ |
| en       | Kokoro-82M (`kokoro-en-v0_19`) | [sherpa-onnx][sherpa] | p95 1.18s/sent | Apache-2.0   |
| vi       | [VieNeu-TTS][vieneu] v3 Turbo  | `vieneu` (ONNX, CPU)  | ~1.2–1.5s/sent | see upstream |

Kokoro was picked over Piper — faster but judged lower quality in a listening
comparison; see `docs/development-journey.md`.

## Voices

Callers ask for a gender; each engine owns which of its own voices that means,
so speaker ids and preset names never leave this service. Both pairs were
chosen by listening to every voice the model ships.

| Language | `female`                | `male`                 |
| -------- | ----------------------- | ---------------------- |
| en       | Kokoro sid 3 `af_sarah` | Kokoro sid 5 `am_adam` |
| vi       | VieNeu `Mai Anh`        | VieNeu `Thanh Bình`    |

Vietnamese cold start is ~8s and the first ever run downloads the model, which
is why both voices load eagerly at startup rather than on first request.

## Run

This is a container — `pnpm dev:all` from the repo root builds it and brings it
up with the rest of the local stack. `models/` is bind-mounted and Kokoro
downloads on first start; the Vietnamese voice is pulled from Hugging Face by
the engine at startup — both voices load eagerly — into the `chatofy_hf_cache`
volume. So the first ever start is slow and `/healthz` answers 503 throughout,
which is what `--wait` is for.

```bash
docker compose up -d --wait local-tts   # just this one
docker compose logs -f local-tts
```

To work on the Python directly instead:

```bash
cd services/local-tts
uv sync
# The sherpa-onnx wheel omits libonnxruntime.so while its native module asks the
# loader for exactly that name, so `import sherpa_onnx` fails until it is linked
# to the versioned file onnxruntime ships. The image does this at build time; a
# host venv needs it again after every `uv sync` that recreates .venv.
ln -sf "$(uv run python -c 'import onnxruntime,pathlib;print(next((pathlib.Path(onnxruntime.__file__).parent/"capi").glob("libonnxruntime.so.*")))')" \
       "$(uv run python -c 'import onnxruntime,pathlib;print(pathlib.Path(onnxruntime.__file__).parent.parent/"sherpa_onnx.libs"/"libonnxruntime.so")')"
uv run python scripts/download_models.py   # one time, idempotent
uv run uvicorn app:app --port 8003
```

## API

| Route              | Request                                                                  | Response                                                                |
| ------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `GET /healthz`     | —                                                                        | `200 {"status":"ok"}` when loaded, `503 {"status":"loading"}` otherwise |
| `POST /synthesize` | JSON `{"text": "…", "language": "en", "gender": "female", "speed": 1.0}` | `200 audio/wav` (PCM16)                                                 |

`language`, `gender` and `speed` are optional. `POST /synthesize` returns `400`
for empty text or a language outside `vi`/`en`, and `503` before the models
finish loading.

```bash
curl -s -X POST http://localhost:8003/synthesize \
  -H 'content-type: application/json' \
  -d '{"text":"Hello, this is a test."}' -o out.wav

curl -s -X POST http://localhost:8003/synthesize \
  -H 'content-type: application/json' \
  -d '{"text":"Xin chào.","language":"vi","gender":"male"}' -o out-vi.wav
```

An unrecognised `gender` falls back to `female` instead of failing —
`/translate` is a public API and a bad value should not cost the caller their
audio. `speed` applies to English only; VieNeu has no speed control.

## Configuration

| Env                 | Default | Purpose                                                                      |
| ------------------- | ------- | ---------------------------------------------------------------------------- |
| `LOCAL_TTS_THREADS` | `8`     | Inference threads. 8 (physical cores) beat 16 (hyperthreads) on this machine |

## Test

```bash
uv run --directory services/local-tts pytest
```

Loads the real models; skip with `LOCAL_TTS_SKIP_MODEL_TESTS=1`.

[kokoro]: https://huggingface.co/hexgrad/Kokoro-82M
[sherpa]: https://github.com/k2-fsa/sherpa-onnx
[vieneu]: https://pypi.org/project/vieneu/
