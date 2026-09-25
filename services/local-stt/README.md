# local-stt sidecar

Local speech-to-text over localhost, no cloud call. Wraps [sherpa-onnx][sherpa]
behind a small FastAPI service so the NestJS API can transcribe Vietnamese and
English through the normal `SttProvider` contract.

Standalone `uv` project — not part of the pnpm/turbo workspace, never imported
by the app (standalone `uv` project, like the benchmark harnesses).

## Models

| Language | Model                                      | WER   | RTF   | p95   | RAM    | License             |
| -------- | ------------------------------------------ | ----- | ----- | ----- | ------ | ------------------- |
| vi       | [hynt/Zipformer-30M-RNNT-6000h][zipformer] | 5.38% | 0.017 | 0.09s | 223MB  | **CC-BY-NC-ND-4.0** |
| en       | [Parakeet-TDT-0.6b-v2][parakeet] (INT8)    | —     | —     | 0.33s | ~1.1GB | CC-BY-4.0           |

Numbers measured on this machine — see
`docs/development-journey.md` for the method and
the alternatives that lost.

> Those WERs are read speech (VIVOS, LibriSpeech). On a real conversation —
> spontaneous, with filler, brand names and English mixed in — the Vietnamese
> engine measured **13.4%** against an independent reference transcript. Both
> numbers are true of the same model; quote whichever matches the condition you
> are describing.

> **English is Parakeet-TDT, not Moonshine base.** On six prod recordings
> replayed through the client's own speech gate, Parakeet scored **3.4% vs 7.4%**
> WER. It answers both the live re-read every 300ms and the settled transcript.
> Under two directions of load on this host: re-read p95 284ms, final p95 327ms,
> no 503s, peak RSS 1.36GB. See `docs/development-journey.md`.

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

sherpa-onnx and onnxruntime are pinned to exact versions, not floors: sherpa-onnx
links libonnxruntime by versioned symbol and its wheel does not bundle the
library, so the two are one ABI pair. sherpa-onnx 1.13.5 and 1.13.6 both need
onnxruntime 1.27.1, which PyPI has never published — neither is installable here.

Both models load eagerly at startup (~6s), so `/healthz` returning 200 means
the service is genuinely ready.

## API

| Route              | Request                                                                                             | Response                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /healthz`     | —                                                                                                   | `200 {"status":"ok"}` when loaded, `503 {"status":"loading"}` otherwise |
| `POST /transcribe` | `multipart/form-data`: `file` (audio), `language` (`vi` or `en`), `hotwords` (repeatable, optional) | `200 {"text":"…","language":"vi"}`                                      |
| `POST /embed`      | `multipart/form-data`: `file` (audio)                                                               | `200 {"vector":[…],"dim":192,"speechMs":1480}`                          |

`speechMs` is how much of the clip is speech, not how long the clip is — the
caller is sent a capture buffer with pre-roll and hangover on it, and the
difference is what tells it whether the vector was built on enough voice to mean
anything. See `audio/speech_duration.py`.

`POST /transcribe` returns `400` for an unsupported language or undecodable
audio, `413` for audio longer than `LOCAL_STT_MAX_AUDIO_SECONDS`, and `503`
before the models finish loading.

```bash
curl -F file=@sample.webm -F language=vi http://localhost:8002/transcribe
# biased towards terms this conversation is known to use
curl -F file=@sample.webm -F language=vi -F hotwords=poker -F hotwords=Target \
     http://localhost:8002/transcribe
```

### Hotwords

Terms the Vietnamese decoder should be biased towards, one form field each,
upper-cased and capped at 48 on arrival. English is the case they exist for: the
Vietnamese model has no path to an English word, so it emits the Vietnamese
syllables that sound closest — measured on a real conversation, "giải poker"
became "giải quốc cơ" and reached the reader as "a national championship".

**A turn that names none decodes exactly as it always did.** `greedy_search`
stays the default, as `docs/development-journey.md` 3.10 recorded, and biasing
lives on a second `modified_beam_search` recognizer chosen only when terms
arrive — `+59MB` RSS, and RTF 1.36x on the biased turn alone.

There is deliberately **no standing list** in the service. One was built and
measured: 28 common English words moved WER on that conversation from 0.137 to
0.148, because biasing towards a word nobody said costs real Vietnamese. Terms
come from the conversation (`TranslationHints.hotwords`), or not at all.

English is unaffected: the Parakeet engine is not set up for biasing, and is
handed none rather than handed them and left to ignore them.

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
[parakeet]: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2
