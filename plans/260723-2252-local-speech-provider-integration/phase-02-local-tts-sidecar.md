---
phase: 2
title: 'Phase 2: Local TTS sidecar'
status: todo
priority: P1
effort: '2h'
dependencies: [1]
---

# Phase 2: Local TTS sidecar

## Overview

Stand up `services/local-tts` on port 8003: a FastAPI sidecar that synthesizes
English speech with Kokoro-82M via sherpa-onnx and returns PCM16 WAV.

Structurally the simplest sidecar — one engine, no audio decoding. It depends
on Phase 1 only to reuse the proven `preload_onnxruntime_dll()` ordering and
the tarball-download pattern, not for any runtime coupling.

## Requirements

- Functional: `POST /synthesize` takes `{text, language, voice?, speed?}` and
  returns `audio/wav` (PCM16).
- Functional: `GET /healthz` reports 200 only once the engine is loaded.
- Functional: `language` other than `en` → 400. English-only by design; vi TTS
  stays with the VieNeu sidecar.
- Non-functional: p95 ≤ 2s per sentence (benchmarked at 1.18s).
- Non-functional: standalone `uv` project, weights gitignored.

## Architecture

```
POST /synthesize {text, language, voice?, speed?}
   └─> engines/kokoro_en.py    sherpa_onnx.OfflineTts (kokoro-en-v0_19)
        └─> soundfile.write(BytesIO, samples, sample_rate, PCM_16) -> audio/wav
```

Same shape as `services/vieneu-tts/app.py`: eager load in the lifespan, one
`threading.Lock` around inference, WAV encoded in-memory with `soundfile`, and
the thread-count env exported before the engine import.

Kokoro config (ported from `benchmarks/tts/tts_bench/engines/sherpa_kokoro_en.py`):

```python
sherpa_onnx.OfflineTtsConfig(
    model=sherpa_onnx.OfflineTtsModelConfig(
        kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
            model=MODEL_DIR / "model.onnx",
            voices=MODEL_DIR / "voices.bin",
            tokens=MODEL_DIR / "tokens.txt",
            data_dir=MODEL_DIR / "espeak-ng-data",
        ),
        num_threads=..., provider="cpu",
    ),
)
```

`config.validate()` must be checked — it returns False on a bad model path
instead of raising, which otherwise surfaces as a confusing later crash.

**Voice handling.** Kokoro selects a speaker by integer `sid`; the
`TtsProvider` contract carries `voice` as a string. Parse it to an int and use
it only when it is within `[0, num_speakers)`; anything else falls back to
`LOCAL_TTS_VOICE_ID` (default `0`, the `af` blend that was benchmarked). The
web app only sends `voice` for `en_to_vi` (`apps/web/src/hooks/use-translate-turn.ts:81`),
which never reaches this sidecar — but `/translate` is a public API, so bad
input must degrade instead of erroring.

## Related Code Files

- Create: `services/local-tts/pyproject.toml`
- Create: `services/local-tts/app.py`
- Create: `services/local-tts/engines/__init__.py`
- Create: `services/local-tts/engines/kokoro_en.py`
- Create: `services/local-tts/scripts/download_models.py`
- Create: `services/local-tts/test_app.py`
- Create: `services/local-tts/README.md`
- Port from (read-only): `benchmarks/tts/tts_bench/engines/sherpa_kokoro_en.py`, `benchmarks/tts/tts_bench/measure.py` (for `preload_onnxruntime_dll`), `benchmarks/tts/scripts/download_models.py`
- Mirror (read-only): `services/vieneu-tts/app.py`

## Implementation Steps

1. **`pyproject.toml`** — same conventions as Phase 1 (`>=3.11.4,<3.12`,
   `[tool.uv] package = false`). Dependencies: `fastapi>=0.115`,
   `uvicorn>=0.30`, `sherpa-onnx>=1.13.4`, `onnxruntime>=1.27.0`,
   `soundfile>=0.12`, `numpy>=1.26`. Dev: `pytest>=8`, `httpx>=0.27`.
   No `av`, no `python-multipart`, no `huggingface-hub` — this service has no
   decode path and fetches only a GitHub release tarball. Then `uv sync`.

2. **`scripts/download_models.py`** — port the Kokoro fetcher from
   `benchmarks/tts/scripts/download_models.py`: download
   `kokoro-en-v0_19.tar.bz2` from the k2-fsa `tts-models` GitHub release,
   extract into `services/local-tts/models/kokoro-en-v0_19/` (`model.onnx`,
   `voices.bin`, `tokens.txt`, `espeak-ng-data/`). Drop the Piper fetcher.
   Idempotent; skip when `tokens.txt` already exists.
   Run: `uv run --directory services/local-tts python scripts/download_models.py`

3. **`engines/kokoro_en.py`** — `preload_onnxruntime_dll()` (same verbatim port
   as Phase 1), `load()` building the config above with `config.validate()`
   checked, and `synthesize(text, sid, speed) -> (np.ndarray, int)` returning
   samples plus sample rate. Owns its `threading.Lock`. Expose
   `num_speakers` so the sid bounds check in `app.py` is real rather than assumed.

4. **`app.py`** — thread env block (`LOCAL_TTS_THREADS`, default `8`) before the
   engine import, then:
   - `GET /healthz` → 200/503 like Phase 1.
   - `POST /synthesize` with a pydantic `SynthesizeRequest`:
     `text: str`, `language: str = "en"`, `voice: str | None = None`,
     `speed: float = 1.0`.
     Empty/whitespace `text` → 400. `language != "en"` → 400. Engine not
     loaded → 503. Resolve sid via the fallback rule above. Synthesize under
     the lock, encode with `soundfile.write(BytesIO, …, format="WAV",
subtype="PCM_16")`, return `Response(media_type="audio/wav")`.

5. **`test_app.py`** — mirror the VieNeu test file, skip guard
   `LOCAL_TTS_SKIP_MODEL_TESTS=1`. Cases: healthz ok; synthesize returns a WAV
   whose bytes start `RIFF`/`WAVE` and exceed a bare 44-byte header; empty text
   → 400; `language="vi"` → 400; out-of-range `voice` still returns 200 (proves
   the fallback, not an error).
   Run: `uv run --directory services/local-tts pytest`

6. **`README.md`** — setup, model download, run command, Apache-2.0 note for
   Kokoro, and a pointer to the TTS benchmark report.

## Success Criteria

- [x] `uv run --directory services/local-tts uvicorn app:app --port 8003` boots and `/healthz` returns 200
- [x] `curl -s -X POST localhost:8003/synthesize -H 'content-type: application/json' -d '{"text":"Hello, this is a test."}' -o out.wav` produces a playable WAV
- [x] Audio is audibly correct English (spot-check by listening — a wrong `data_dir` yields garbled phonemes rather than an error)
- [x] `language="vi"` → 400; empty text → 400; `voice="999"` → 200 using the default speaker
- [x] Observed p95 per sentence ≈ 1.2s, consistent with the benchmark
- [x] `uv run --directory services/local-tts pytest` passes

## Measured result (recorded during implementation)

Closed-loop check instead of subjective listening: Kokoro synthesized
"The weather is beautiful today and I would like to walk in the park", the
local-stt Moonshine engine transcribed the WAV back, and the text matched
word for word. That rules out the `espeak-ng-data` garbling risk objectively —
garbled phonemes would not survive a round trip.

Steady-state latency over 5 consecutive calls (14-word sentence, 3.35s of
audio): 1393 / 1392 / 1384 / 1361 / 1401 ms → **RTF ≈ 0.42** including HTTP and
WAV encoding, against **0.323** measured for the engine in isolation.

The ~28% gap is expected — the benchmark timed the engine in a dedicated
subprocess with no HTTP layer. It is well inside the ≤2s p95 target and below
the 2× investigate-first threshold, so it is recorded rather than chased.

## Risk Assessment

- **Missing/wrong `espeak-ng-data` (Medium).** Kokoro needs it for
  grapheme-to-phoneme. A wrong `data_dir` degrades output quality silently
  rather than failing — hence the listening check in the success criteria.
- **`config.validate()` ignored (Medium).** It returns False instead of
  raising; skipping the check turns a bad path into an obscure downstream crash.
- **sid out of range (Low).** Handled by the bounds check plus fallback; covered
  by a test.
- **Duplicated helper code with Phase 1 (Low, accepted).** ~30 lines
  (`preload_onnxruntime_dll`, thread env, tarball download) are copied rather
  than shared. Deliberate: the two services stay independently runnable, and a
  shared Python package for 30 lines is not warranted.
