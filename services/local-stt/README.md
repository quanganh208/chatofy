# local-stt sidecar

Local speech-to-text over localhost, no cloud call. Wraps [sherpa-onnx][sherpa]
behind a small FastAPI service so the NestJS API can transcribe Vietnamese and
English through the normal `SttProvider` contract.

Standalone `uv` project — not part of the pnpm/turbo workspace, never imported
by the app (standalone `uv` project, like the benchmark harnesses).

## Models

| Language | Model                                       | WER    | RTF   | RAM    | License             |
| -------- | ------------------------------------------- | ------ | ----- | ------ | ------------------- |
| vi       | [Nemotron 3.5 ASR streaming 0.6b][nemotron] | 10.93% | 0.20  | 1054MB | OpenMDW-1.1         |
| vi (alt) | [hynt/Zipformer-30M-RNNT-6000h][zipformer]  | 5.38%  | 0.017 | 223MB  | **CC-BY-NC-ND-4.0** |
| en       | [Moonshine base][moonshine] (INT8)          | 3.86%  | 0.040 | 418MB  | MIT                 |

Measured on this machine over the shared benchmark sets — VIVOS test (vi) and
LibriSpeech test-clean (en), 50 utterances each, one normalization pipeline for
every engine. Method and the alternatives that lost:
`benchmarks/stt`, `docs/development-journey.md`.

The Vietnamese RTF above is the streaming figure, because that is the path the
app runs; decoding the same audio in one pass costs 0.069. Streaming is not
worse on accuracy — measured at 10.93% streaming vs 11.29% offline, i.e. within
noise. Speaking mid-sentence costs CPU, not correctness.

`q8_0` is the right quantization **on this CPU specifically**: it is both the
most accurate and the fastest of the five published quants, because AVX-512 VNNI
multiplies INT8 in hardware while the k-quants must be unpacked first. On a CPU
without VNNI that ordering would likely invert.

> **Why the worse model is the default.** Zipformer is 5.5 points better and it
> is still here — but it decodes the whole buffer each time, so it _revises words
> it has already produced_ (66 and 38 of them on real disfluent speech). That is
> fine when the transcript is text on a screen and fatal when it has already been
> spoken aloud. Nemotron decodes causally and never revisits consumed audio, so
> its prefix is append-only by construction — but ONLY through the streaming
> session below. `/transcribe` decodes whole utterances whatever the engine, so a
> caller that re-reads a growing buffer through it gets no such guarantee and
> pays the accuracy cost for nothing. That was the shape of this service for its
> first two weeks.
>
> Both Vietnamese engines are loaded together: the streaming one for audio that
> is about to be spoken, the accurate one for text on a screen, which
> `server.transcript.partial` is free to replace. `LOCAL_STT_VI_ENGINE=zipformer`
> drops the streaming engine entirely and returns to one engine for both roles.
>
> The gap is 5.5 points on clean read speech (the table above) and 7–9 on
> spontaneous speech with hesitations. Both are real; they measure different
> audio, so quote whichever matches the situation being argued about.

The Vietnamese RAM figure is the loaded model, paid once. A streaming session
adds ~60MB and does **not** grow with turn length; whole-utterance decoding grows
at roughly 9MB per second of audio instead.

> **License obligation.** Zipformer-30M is CC-BY-NC-ND-4.0: **academic / thesis
> use only**, no commercial use, no distribution of derivatives. If this project
> is ever commercialized, swap in PhoWhisper behind the same `SttProvider`
> contract (measured at ~1.3s/utterance instead of ~0.1s).

## Setup

```bash
cd services/local-stt
uv sync
uv run python scripts/download_models.py   # ~1.5GB, one time, idempotent
```

### Building the streaming runtime

The Vietnamese engine loads its model through [parakeet.cpp][parakeet], a C++
ggml runtime with no Python wheel — build it once and point the service at the
resulting shared library:

```bash
git clone --recursive https://github.com/mudler/parakeet.cpp   # pinned at 1bfbebf
git -C parakeet.cpp apply "$PWD/scripts/parakeet-suppress-language-tags.patch"
cmake -S parakeet.cpp -B parakeet.cpp/build \
      -DCMAKE_BUILD_TYPE=Release -DPARAKEET_SHARED=ON
cmake --build parakeet.cpp/build -j

# Beside the weights, where the service looks by default.
mkdir -p runtime && cp -P parakeet.cpp/build/lib*.so* runtime/
```

Copy the ggml libraries too, not just `libparakeet.so` — it links against them.
Nothing needs exporting: `runtime/` is where the engine looks, and it is
gitignored like `models/`. `LOCAL_STT_PARAKEET_LIB` overrides it for a build kept
somewhere else.

`--recursive` matters: the ggml submodule is not vendored, and the build fails
late and confusingly without it.

**The patch is not optional.** Upstream lets the greedy decoder emit the
multilingual language-tag tokens (`<vi-VN>` and 38 others). The model predicts
one at an abrupt acoustic boundary — a speaker change, a mic cut — and feeding it
back into the prediction network drops the decoder into blank for every remaining
frame: the transcript stops dead while audio keeps arriving, with no error. On
the 41s test fixture that is 101 words instead of 144, the tail silently missing.
The patch bars those tokens from the output vocabulary; `PK_SUPPRESS_LANG_TAGS=0`
restores upstream behaviour for comparison. Reported upstream is still to do.

Running with `LOCAL_STT_VI_ENGINE=zipformer` skips all of this.

## Run

```bash
uv run --directory services/local-stt uvicorn app:app --port 8002
```

Or start the whole local stack from the repo root with `pnpm dev:all`.

Both models load eagerly at startup, so `/healthz` returning 200 means the
service is genuinely ready.

## API

| Route                        | Request                                                                                            | Response                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /healthz`               | —                                                                                                  | `200 {"status":"ok"}` when loaded, `503 {"status":"loading"}` otherwise |
| `POST /transcribe`           | `multipart/form-data`: `file` (audio, any container), `language` (`vi` or `en`), optional `engine` | `200 {"text":"…","language":"vi"}`                                      |
| `POST /stream`               | `multipart/form-data`: `language`                                                                  | `200 {"stream_id":"…","language":"vi"}`                                 |
| `POST /stream/{id}/feed`     | raw PCM16 LE mono 16 kHz body                                                                      | `200 {"text":"…"}` — the DELTA, not the running transcript              |
| `POST /stream/{id}/finalize` | —                                                                                                  | `200 {"text":"…"}` — the decoder's tail                                 |
| `DELETE /stream/{id}`        | —                                                                                                  | `200 {"closed":"…"}`                                                    |

`POST /transcribe` returns `400` for an unsupported language, an engine name the
language does not serve, or undecodable audio; `413` for audio longer than
`LOCAL_STT_MAX_AUDIO_SECONDS`; and `503` before the models finish loading.

```bash
curl -F file=@sample.webm -F language=vi http://localhost:8002/transcribe
```

### Streaming sessions

The causal path, and the only one whose output is safe to speak before the
speaker has stopped: `feed` returns **only what that chunk finalized**, so a
caller appends and never has to take anything back. `/transcribe` cannot promise
that at any cadence, because it decodes each request from scratch.

`POST /stream` returns `409` when the language's engine decodes whole utterances
only — English today, and Vietnamese under `LOCAL_STT_VI_ENGINE=zipformer`. That
is deliberately distinct from `400`: a caller must be able to tell "bad request"
from "this deployment cannot do that", because only the second is a reason to
fall back to whole-utterance decoding.

A session pins roughly 60MB of decoder state and is closed automatically after
30 seconds without a feed, with a warning logged — a client that vanishes
mid-turn will never call `DELETE`, and cannot be detected from here.

```bash
id=$(curl -sF language=vi localhost:8002/stream | jq -r .stream_id)
curl -s --data-binary @chunk.pcm -H 'content-type: application/octet-stream' \
  localhost:8002/stream/$id/feed
curl -sX POST localhost:8002/stream/$id/finalize
curl -sX DELETE localhost:8002/stream/$id
```

Audio is decoded with PyAV, which bundles its own ffmpeg libraries — **no ffmpeg
binary needs to be installed**. Anything ffmpeg reads works: the browser's
`audio/webm;codecs=opus`, plus uploaded mp3/m4a/wav/flac/ogg. Input is always
resampled to mono 16 kHz because both models are trained at that rate.

## Configuration

| Env                           | Default                                     | Purpose                                                                                              |
| ----------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `LOCAL_STT_THREADS`           | `8`                                         | Threads per engine. 8 (physical cores) beat 16 (hyperthreads) on this machine                        |
| `LOCAL_STT_MAX_AUDIO_SECONDS` | `300`                                       | Longest utterance accepted; longer audio returns `413` instead of decoding it                        |
| `LOCAL_STT_VI_ENGINE`         | `nemotron`                                  | Which engine SPEAKS. `nemotron` also loads `zipformer` for the screen; `zipformer` loads only itself |
| `LOCAL_STT_PARAKEET_LIB`      | `runtime/libparakeet.so`                    | Override the built library's location                                                                |
| `LOCAL_STT_NEMOTRON_GGUF`     | `models/nemotron-streaming-0.6b/…q8_0.gguf` | Override the weights path                                                                            |

## Test

```bash
uv run --directory services/local-stt pytest
```

`test_decode.py` needs no model weights, and neither do the language-tag and
engine-selection tests in `test_nemotron_vi.py`. `test_app.py` loads the real
models; skip it with `LOCAL_STT_SKIP_MODEL_TESTS=1`. The streaming tests also
need `LOCAL_STT_PARAKEET_LIB` and skip themselves without it.

[sherpa]: https://github.com/k2-fsa/sherpa-onnx
[zipformer]: https://huggingface.co/hynt/Zipformer-30M-RNNT-6000h
[moonshine]: https://github.com/usefulsensors/moonshine
[nemotron]: https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b
[parakeet]: https://github.com/mudler/parakeet.cpp
