# local-stt sidecar

Local speech-to-text over localhost, no cloud call. Wraps [sherpa-onnx][sherpa]
behind a small FastAPI service so the NestJS API can transcribe Vietnamese and
English through the normal `SttProvider` contract.

Standalone `uv` project — not part of the pnpm/turbo workspace, never imported
by the app (standalone `uv` project, like the benchmark harnesses).

## Models

| Language | Model                                      | WER   | RTF   | p95   | RAM   | License             |
| -------- | ------------------------------------------ | ----- | ----- | ----- | ----- | ------------------- |
| vi       | [hynt/Zipformer-30M-RNNT-6000h][zipformer] | 5.38% | 0.017 | 0.09s | 223MB | **CC-BY-NC-ND-4.0** |
| en       | [Moonshine base][moonshine] (INT8)         | 3.86% | 0.040 | 0.34s | 418MB | MIT                 |

Numbers measured on this machine — see
`docs/development-journey.md` for the method and
the alternatives that lost.

> **License obligation.** Zipformer-30M is CC-BY-NC-ND-4.0: **academic / thesis
> use only**, no commercial use, no distribution of derivatives. If this project
> is ever commercialized, swap in PhoWhisper behind the same `SttProvider`
> contract (measured at ~1.3s/utterance instead of ~0.1s).

## Run

This is a container — `pnpm dev:all` from the repo root builds it and brings it
up with the rest of the local stack. `models/` is bind-mounted and the weights
(~1.3GB) download on first start, so there is no separate setup step.

```bash
docker compose up -d --wait local-stt   # just this one
docker compose logs -f local-stt
```

To work on the Python directly instead:

```bash
cd services/local-stt
uv sync
# The sherpa-onnx wheel omits libonnxruntime.so while its native module asks the
# loader for exactly that name, so `import sherpa_onnx` fails until it is linked
# to the versioned file onnxruntime ships. The image does this at build time; a
# host venv needs it again after every `uv sync` that recreates .venv.
ln -sf "$(uv run python -c 'import onnxruntime,pathlib;print(next((pathlib.Path(onnxruntime.__file__).parent/"capi").glob("libonnxruntime.so.*")))')" \
       "$(uv run python -c 'import onnxruntime,pathlib;print(pathlib.Path(onnxruntime.__file__).parent.parent/"sherpa_onnx.libs"/"libonnxruntime.so")')"
uv run python scripts/download_models.py   # ~1.3GB, one time, idempotent
uv run uvicorn app:app --port 8002
```

Both models load eagerly at startup (<3s), so `/healthz` returning 200 means
the service is genuinely ready.

## API

| Route              | Request                                                                         | Response                                                                |
| ------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /healthz`     | —                                                                               | `200 {"status":"ok"}` when loaded, `503 {"status":"loading"}` otherwise |
| `POST /transcribe` | `multipart/form-data`: `file` (audio, any container), `language` (`vi` or `en`) | `200 {"text":"…","language":"vi"}`                                      |

`POST /transcribe` returns `400` for an unsupported language or undecodable
audio, `413` for audio longer than `LOCAL_STT_MAX_AUDIO_SECONDS`, and `503`
before the models finish loading.

```bash
curl -F file=@sample.webm -F language=vi http://localhost:8002/transcribe
```

Audio is decoded with PyAV, which bundles its own ffmpeg libraries — **no ffmpeg
binary needs to be installed**. Anything ffmpeg reads works: the browser's
`audio/webm;codecs=opus`, plus uploaded mp3/m4a/wav/flac/ogg. Input is always
resampled to mono 16 kHz because both models are trained at that rate.

## Configuration

| Env                           | Default | Purpose                                                                       |
| ----------------------------- | ------- | ----------------------------------------------------------------------------- |
| `LOCAL_STT_THREADS`           | `8`     | Threads per engine. 8 (physical cores) beat 16 (hyperthreads) on this machine |
| `LOCAL_STT_MAX_AUDIO_SECONDS` | `300`   | Longest utterance accepted; longer audio returns `413` instead of decoding it |

## Test

```bash
uv run --directory services/local-stt pytest
```

`test_decode.py` needs no model weights. `test_app.py` loads the real models;
skip it with `LOCAL_STT_SKIP_MODEL_TESTS=1`.

[sherpa]: https://github.com/k2-fsa/sherpa-onnx
[zipformer]: https://huggingface.co/hynt/Zipformer-30M-RNNT-6000h
[moonshine]: https://github.com/usefulsensors/moonshine
