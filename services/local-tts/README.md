# local-tts sidecar

Local speech synthesis over localhost, no cloud call. A small FastAPI service so
the NestJS API can synthesize through the normal `TtsProvider` contract.

Standalone `uv` project — not part of the pnpm/turbo workspace, never imported
by the app (same convention as the benchmark harnesses).

**Both output languages.** The engine is chosen from the `language` field, so
the two runtimes below are invisible to callers.

## Models

| Language | Model                                 | Runtime               | Latency        | License      |
| -------- | ------------------------------------- | --------------------- | -------------- | ------------ |
| en       | Kokoro-82M (`kokoro-multi-lang-v1_0`) | [sherpa-onnx][sherpa] | p95 0.86s/sent | Apache-2.0   |
| vi       | [VieNeu-TTS][vieneu] v3 Turbo         | `vieneu` (ONNX, CPU)  | ~1.2–1.5s/sent | see upstream |

Kokoro was picked over Piper — faster but judged lower quality in a listening
comparison; see `docs/development-journey.md`.

Kokoro moved from the English-only `kokoro-en-v0_19` to `kokoro-multi-lang-v1_0`,
keeping the same two voices at their renumbered speaker ids. v1.0 measured
slightly faster over the benchmark's 30 sentences and far more consistent —
v0_19's p95 ranged 0.87–1.65s across five runs where v1.0 stayed 0.82–0.90s.
Note that v1.1 exists but is a Chinese fine-tune with only three English voices
and no American male at all, so it is not an upgrade path for this service.

VieNeu is pinned to the fp32 backbone graph. The package defaults to int8
(smaller, faster per frame), but fp32 is what the voices below were auditioned
on, so switching needs a listening comparison first, not just a version bump.

## Voices

Callers ask for a gender, and get one of these — the pair each engine speaks
with when no specific voice is named. Both were chosen by listening to every
voice the model shipped at the time.

| Language | `female`                | `male`                  |
| -------- | ----------------------- | ----------------------- |
| en       | Kokoro sid 9 `af_sarah` | Kokoro sid 11 `am_adam` |
| vi       | VieNeu `Mai Anh`        | VieNeu `Thanh Bình`     |

A caller may instead name one voice out of `GET /voices`, which publishes 20 per
language:

- **en** — Kokoro's US English block, speaker ids 0–19 (`af_alloy` … `am_santa`).
  It stops there because `load` wires up the US English lexicon alone, so ids 20+
  (British, French, Hindi, Italian, Japanese, Portuguese, Chinese) would be
  phonemized as American English whatever they sound like.
- **vi** — every preset the installed `vieneu` package publishes, read from its
  own manifest at import, so a package that ships more offers more without a code
  change. Labels carry the region (`Trúc Ly · Bắc`), which is the first thing a
  Vietnamese listener wants to know.

Tokens are opaque to callers — a speaker id for one runtime, a preset name for
the other — and each engine whitelists an incoming one against its own catalog.
An unrecognised token falls back to the gender default rather than failing: a
stale choice costs the caller their voice, never their audio.

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

sherpa-onnx and onnxruntime are pinned to exact versions, not floors: sherpa-onnx
links libonnxruntime by versioned symbol and its wheel does not bundle the
library, so the two are one ABI pair. sherpa-onnx 1.13.5 and 1.13.6 both need
onnxruntime 1.27.1, which PyPI has never published — neither is installable here.

## API

| Route              | Request                                                                  | Response                                                                |
| ------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `GET /healthz`     | —                                                                        | `200 {"status":"ok"}` when loaded, `503 {"status":"loading"}` otherwise |
| `GET /voices`      | `?language=en`                                                           | `200 {"voices":[{"token","label","gender"}]}`                           |
| `POST /synthesize` | JSON `{"text": "…", "language": "en", "gender": "female", "speed": 1.0}` | `200 audio/wav` (PCM16)                                                 |

`language`, `gender`, `speed` and `voice` are optional. `POST /synthesize`
returns `400` for empty text or a language outside `vi`/`en`, and `503` before
the models finish loading. `GET /voices` defaults to `en` and `400`s on a
language outside the pair.

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

| Env                 | Default | Purpose                                                                         |
| ------------------- | ------- | ------------------------------------------------------------------------------- |
| `LOCAL_TTS_THREADS` | `8`     | Inference threads, both engines. 8 (physical cores) beat 16 (hyperthreads) here |

## Test

```bash
uv run --directory services/local-tts pytest
```

Loads the real models; skip with `LOCAL_TTS_SKIP_MODEL_TESTS=1`.

[kokoro]: https://huggingface.co/hexgrad/Kokoro-82M
[sherpa]: https://github.com/k2-fsa/sherpa-onnx
[vieneu]: https://pypi.org/project/vieneu/
