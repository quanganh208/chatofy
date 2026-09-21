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

VieNeu is pinned to the fp32 backbone graph. Through 3.3.0 the package defaulted
to int8 (smaller, faster per frame), so the pin was a correction; 3.4.0 made fp32
the default and it now states a choice. It stays fp32 because what this pin has
always required is a listening comparison, and one has still not been made.
The measurement behind that decision now exists: on the benchmark's 41-sentence
conversational set int8 ran ~1.5x faster (RTF 0.30–0.32 against 0.45–0.48) with
intelligibility it did not separate from fp32 on either voice, though its point
estimate on `Thanh Bình` was adverse and unseparated — so the audition is what
should settle it, not the WER alone
(`benchmarks/tts-vi/results/report-speed-v381.md`).

## Voices

Callers ask for a gender, and get one of these — the pair each engine speaks
with when no specific voice is named. Both were chosen by listening to every
voice the model shipped at the time.

| Language | `female`                | `male`                  |
| -------- | ----------------------- | ----------------------- |
| en       | Kokoro sid 9 `af_sarah` | Kokoro sid 11 `am_adam` |
| vi       | VieNeu `Mai Anh`        | VieNeu `Thanh Bình`     |

A caller may instead name one voice out of `GET /voices`. The two languages do not
publish the same number of voices — en offers 20, vi offers 25:

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

| Route                     | Request                                                                  | Response                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `GET /healthz`            | —                                                                        | `200 {"status":"ok"}` when loaded, `503 {"status":"loading"}` otherwise                                        |
| `GET /voices`             | `?language=en`                                                           | `200 {"voices":[{"token","label","gender"}]}`                                                                  |
| `POST /synthesize`        | JSON `{"text": "…", "language": "en", "gender": "female", "speed": 1.0}` | `200 audio/wav` (PCM16)                                                                                        |
| `POST /synthesize/stream` | Same JSON as `/synthesize`; `text` at most 2000 characters               | `200 application/octet-stream`, raw PCM16 LE mono, chunked; headers `X-Sample-Rate`, `X-Audio-Encoding: pcm16` |

`language`, `gender`, `speed` and `voice` are optional. `POST /synthesize`
returns `400` for empty text or a language outside `vi`/`en`, and `503` before
the models finish loading or when its engine stayed busy — held by a stream —
for more than 10 s. That wait sits under the API's own 15 s deadline for the
call, so a request that finally gets the engine is never synthesized for a caller
that has already given up. `GET /voices` defaults to `en` and `400`s on a
language outside the pair.

A busy engine's `503` carries the header `X-Engine-Busy: 1`, on both synthesis
endpoints; "models not loaded" does not. The API tells the two apart by it: a
live turn whose engine was busy ends without audio (`server.session.ended`
reason `engine_busy`) instead of failing, while a sidecar that is not ready is
reported as a fault.

```bash
curl -s -X POST http://localhost:8003/synthesize \
  -H 'content-type: application/json' \
  -d '{"text":"Hello, this is a test."}' -o out.wav

curl -s -X POST http://localhost:8003/synthesize \
  -H 'content-type: application/json' \
  -d '{"text":"Xin chào.","language":"vi","gender":"male"}' -o out-vi.wav
```

`POST /synthesize/stream` sends audio as the engine produces it. The API sends
text longer than its 2000-character cap to `/synthesize` clause by clause instead,
so the cap never costs a turn its audio. VieNeu streams
the whole text frame by frame (`infer_stream`); Kokoro produces audio only at
sentence boundaries, so it streams one clause at a time. Status and headers go
out only once the first chunk exists, so every failure before the first sample
still gets a real status code: `400`/`422`/`503` as above, `503` when the engine
stayed busy past the wait below, `500` for a synthesis error. A failure after
that ends the body without its terminating chunk, which a client reads as an
error rather than a short turn.

A Vietnamese stream holds its engine for the whole text. That keeps a seeded
VieNeu stream reproducible — it draws from the process-wide RNG on every frame —
and it means a second Vietnamese turn waits for the first, up to 15 s, then gets
the busy `503` above. Waiters are not served in arrival order. This is a
deliberate trade for a single-machine deployment with few concurrent speakers:
two overlapping Vietnamese turns whose first runs longer than 15 s leave the
second without audio, where the older clause-by-clause path interleaved them.
Kokoro is unseeded, so an English stream takes the lock per clause and a second
English turn waits one clause per turn ahead of it, not a whole turn. That wait
recurs before every clause, and a busy answer part-way through a body has no
status to carry: a stream whose wait between chunks outlasts the API's 15 s
idle deadline is reported as a failed turn, not a busy one. It takes several
overlapping English turns with long unpunctuated clauses to get there. The lock
comes back when the stream finishes, when it fails, and when the client
disconnects (at the next chunk). A client that stays connected but stops reading
is bounded by the 60 s cap on one stream (counted from its first chunk): socket buffers absorb megabytes before
any backpressure reaches the sidecar, so the 5 s stall guard in
`stream_worker.py` rarely gets the chance to fire.

```bash
curl -sN -X POST http://localhost:8003/synthesize/stream \
  -H 'content-type: application/json' \
  -d '{"text":"Xin chào, bạn khỏe không?","language":"vi"}' -D - -o out-vi.pcm
```

VieNeu is seeded per voice (`engines/vieneu_vi.py`, `SEEDS`), on both endpoints,
so the same text in the same voice produces the same speech.

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
`test_clause_splitter.py` needs no models: it holds the Kokoro clause splitter to
the fixture the API's TypeScript splitter is tested against
(`apps/api/src/modules/translate/audio/clause-splitter.cases.json`). CI does not
run it, so run it after touching either splitter.

[kokoro]: https://huggingface.co/hexgrad/Kokoro-82M
[sherpa]: https://github.com/k2-fsa/sherpa-onnx
[vieneu]: https://pypi.org/project/vieneu/
