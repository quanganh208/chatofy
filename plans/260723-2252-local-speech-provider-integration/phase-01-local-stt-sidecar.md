---
phase: 1
title: 'Phase 1: Local STT sidecar'
status: todo
priority: P1
effort: '4h'
dependencies: []
---

# Phase 1: Local STT sidecar

## Overview

Stand up `services/local-stt` on port 8002: a FastAPI sidecar that accepts any
browser audio container and returns a transcript, using Zipformer-30M for
Vietnamese and Moonshine-base for English via sherpa-onnx.

This is the highest-risk phase — it owns the only unverified assumption in the
plan (PyAV on Windows) and the process-abort hazard (ORT DLL resolution).

## Requirements

- Functional: `POST /transcribe` accepts multipart audio in any container the
  browser produces (webm/opus, mp4/aac) plus uploaded files (mp3, m4a, wav,
  flac, ogg) and returns `{text, language}` for `language` in `{vi, en}`.
- Functional: `GET /healthz` reports 200 only when both engines are loaded.
- Non-functional: transcription latency on 16 kHz speech stays in the
  benchmarked band (vi p95 ~0.09s, en p95 ~0.34s) plus decode overhead.
- Non-functional: no model weights enter git.
- Non-functional: standalone `uv` project — not in the pnpm/turbo workspace,
  never imported by the app (same rule as `services/vieneu-tts`).

## Architecture

```
POST /transcribe (multipart: file, language)
   └─> audio/decode.py      PyAV: any container -> mono float32 @ 16 kHz
        └─> engines/registry.py    language -> engine (loaded eagerly at startup)
             ├─ zipformer_vi.py    sherpa_onnx.OfflineRecognizer.from_transducer
             └─ moonshine_en.py    sherpa_onnx.OfflineRecognizer.from_moonshine
                  └─> {"text": ..., "language": ...}
```

Both engines load eagerly in the FastAPI lifespan (~640MB, <2.5s total) so
`/healthz` is honest and the first request has no load spike.

Each engine owns a `threading.Lock`. Per-engine (not per-process) so vi and en
can run concurrently; a single engine object is not assumed thread-safe.

`preload_onnxruntime_dll()` runs once in `registry.load_all()` **before** any
`import sherpa_onnx`. Without it the loader resolves `onnxruntime.dll` from
`System32` (Windows ML build, ORT 1.17.1), which lacks the C API version
sherpa-onnx was built against, and the process dies with a hard abort — not a
catchable Python exception.

Thread counts must be exported before the engine module is imported, because
ONNX Runtime sizes its thread pool at import:

```python
# app.py — top of file, before any engine import
_threads = os.environ.get("LOCAL_STT_THREADS", "8")
os.environ.setdefault("OMP_NUM_THREADS", _threads)
os.environ.setdefault("MKL_NUM_THREADS", _threads)
```

## Related Code Files

- Create: `services/local-stt/pyproject.toml`
- Create: `services/local-stt/app.py`
- Create: `services/local-stt/engines/__init__.py`
- Create: `services/local-stt/engines/base.py`
- Create: `services/local-stt/engines/registry.py`
- Create: `services/local-stt/engines/zipformer_vi.py`
- Create: `services/local-stt/engines/moonshine_en.py`
- Create: `services/local-stt/audio/__init__.py`
- Create: `services/local-stt/audio/decode.py`
- Create: `services/local-stt/scripts/download_models.py`
- Create: `services/local-stt/conftest.py`
- Create: `services/local-stt/test_app.py`
- Create: `services/local-stt/test_decode.py`
- Create: `services/local-stt/test_postprocess.py`
- Create: `services/local-stt/.gitignore`
- Create: `services/local-stt/README.md`
- Port from (read-only): `benchmarks/stt/stt_bench/engines/{base,sherpa_zipformer_vi,sherpa_moonshine_en}.py`, `benchmarks/stt/scripts/download_models.py`
- Mirror (read-only): `services/vieneu-tts/{app.py,pyproject.toml,test_app.py}`

## Implementation Steps

1. **PyAV spike — gate before anything else.** In a throwaway venv on this
   machine (Windows, Python 3.11):

   ```bash
   uv run --with av --with numpy python -c "import av; print(av.__version__)"
   ```

   Then decode one real browser recording (record a short webm/opus clip from
   the web app, or reuse any `.webm`) end-to-end to float32 @ 16 kHz.
   - **Pass** → continue to Step 2.
   - **Fail** → stop and switch the decode strategy to an ffmpeg subprocess,
     note the added system dependency in the delivery report, then continue.
     Do not silently work around it.

2. **`services/local-stt/.gitignore`** — ignore `models/`, `.venv/`,
   `__pycache__/`, `*.pyc`, `.pytest_cache/`. The repo keeps a per-service
   `.gitignore` for Python subprojects (`services/vieneu-tts/.gitignore`,
   `benchmarks/*/.gitignore`) rather than listing them at the root — follow that.
   This must land **before** Step 4 so the ~500MB of weights is never staged.

3. **`pyproject.toml`** — mirror `services/vieneu-tts/pyproject.toml`:
   `requires-python = ">=3.11.4,<3.12"` (tarfile `filter="data"` needs 3.11.4),
   `[tool.uv] package = false`, no build backend.
   Dependencies: `fastapi>=0.115`, `uvicorn>=0.30`, `python-multipart>=0.0.9`,
   `sherpa-onnx>=1.13.4`, `onnxruntime>=1.27.0`, `av>=13`, `numpy>=1.26`,
   `huggingface-hub>=1.24.0`, `sentencepiece>=0.2.2`.
   Dev group: `pytest>=8`, `httpx>=0.27`.
   Then `uv sync`.

4. **`scripts/download_models.py`** — port `fetch_zipformer_vi` and
   `fetch_moonshine_en` from `benchmarks/stt/scripts/download_models.py`
   verbatim, retargeting `MODELS_DIR` to `services/local-stt/models/`. Drop the
   faster-whisper fetchers. Keep it idempotent.
   - Zipformer: 3 INT8 ONNX files + `bpe.model` from `hynt/Zipformer-30M-RNNT-6000h`,
     then generate `tokens.txt` via sentencepiece (the HF repo ships no token table).
   - Moonshine: `sherpa-onnx-moonshine-base-en-int8.tar.bz2` from the k2-fsa
     `asr-models` GitHub release, extracted.
     Run it: `uv run --directory services/local-stt python scripts/download_models.py`

5. **`audio/decode.py`** — one public function:

   ```python
   TARGET_RATE = 16000

   class DecodeError(Exception): ...

   def decode_to_16k_mono(data: bytes) -> np.ndarray:
       """Any container/codec -> mono float32 @ 16 kHz, the rate the models expect."""
   ```

   Open `io.BytesIO(data)` with `av.open`, pick the first audio stream, push
   frames through `AudioResampler(format="fltp", layout="mono", rate=16000)`,
   flush with `resample(None)`, concatenate to one 1-D float32 array.
   Notes for the implementer:
   - `resampler.resample()` returns a **list** of frames on PyAV ≥ 9 and a
     single frame/`None` on older versions — normalize both.
   - Confirm during the spike whether `fltp` or `flt` yields the expected
     `(1, n)` ndarray for mono, and reshape to `(-1)`.
   - Resample explicitly. Do not rely on sherpa-onnx to resample: mic audio is
     48 kHz and the models are trained at 16 kHz.
   - No audio stream, zero samples, or any `av` error → raise `DecodeError`.

6. **`engines/`** — port the load/decode bodies from the benchmark harness:
   - `zipformer_vi.py`: `OfflineRecognizer.from_transducer(encoder=…int8.onnx,
decoder=…, joiner=…, tokens=tokens.txt, num_threads, decoding_method="greedy_search")`
   - `moonshine_en.py`: `OfflineRecognizer.from_moonshine(preprocessor=preprocess.onnx,
encoder=encode.int8.onnx, uncached_decoder=uncached_decode.int8.onnx,
cached_decoder=cached_decode.int8.onnx, tokens=tokens.txt, num_threads)`
   - Each exposes `load()` and `transcribe(samples: np.ndarray) -> str`, holds
     its own `threading.Lock`, and takes samples (not a file path) — the
     harness reads WAV files, this service receives decoded arrays.
   - `registry.py`: `preload_onnxruntime_dll()` (ported verbatim from
     `benchmarks/stt/stt_bench/engines/base.py`), a `{"vi": …, "en": …}` map,
     `load_all()`, `get(lang)`, `ready()`.

7. **`app.py`** — thread env block first (see Architecture), then FastAPI with
   `lifespan` calling `registry.load_all()`:
   - `GET /healthz` → 200 `{"status":"ok"}` when `registry.ready()`, else 503
     `{"status":"loading"}`
   - `POST /transcribe`: `file: UploadFile`, `language: str = Form(...)`.
     Reject `language not in {"vi","en"}` with 400. Reject empty body with 400.
     `DecodeError` → 400. Engines not loaded → 503. Success → `{"text","language"}`.
     Run inference under the engine's lock (the sync endpoint executes in
     FastAPI's threadpool, so the lock is what serializes contention).

8. **Tests.** `conftest.py` builds a real webm/opus payload in memory so the
   decode path is exercised for real. `test_decode.py` and `test_postprocess.py`
   need no weights; `test_app.py` mirrors `services/vieneu-tts/test_app.py`
   (module-scoped `TestClient(app)` fixture whose `with` block triggers
   lifespan) behind the skip guard `LOCAL_STT_SKIP_MODEL_TESTS=1`.
   Endpoint cases: healthz ok; transcribe returns a `text` field per language;
   bad language → 400; garbage bytes → 400; missing `language` → 422.
   Transcript _content_ is not asserted — the fixture is a synthetic sweep, not
   speech, so an empty transcript is correct. Real-speech accuracy is verified
   manually (success criteria below).
   Run: `uv run --directory services/local-stt pytest`

   **Vietnamese output normalization (decided during implementation).**
   Zipformer emits bare uppercase with no punctuation
   (`NGỌN LỬA BẠO ĐỘNG…`, confirmed in
   `benchmarks/stt/results/r1/sherpa-zipformer-vi.jsonl`), while Moonshine emits
   sentence-cased, punctuated prose. Benchmark WER normalization lowercases and
   strips punctuation, which hid the difference. Since `sourceText` is shown in
   the UI, shipping this as-is would be a visible regression against the
   ElevenLabs default being replaced. Resolution: a `postprocess()` hook on
   `SttEngine` (identity by default) overridden in `ZipformerVi` to lowercase
   and sentence-case. Proper nouns stay lowercased; restoring them needs a
   casing/punctuation model and is explicitly out of scope.

9. **`README.md`** — setup, model download, run command, the
   CC-BY-NC-ND-4.0 restriction on Zipformer-30M (academic use only), and a
   pointer to the benchmark report.

## Success Criteria

- [x] PyAV spike passed on this machine, or the ffmpeg fallback is in place and recorded
- [x] `models/` is gitignored and `git status` stays clean after downloading weights
- [x] `uv run --directory services/local-stt uvicorn app:app --port 8002` boots and `/healthz` returns 200 within ~3s
- [x] `curl -F file=@sample.webm -F language=vi localhost:8002/transcribe` returns sensible Vietnamese text
- [x] Same for an English clip with `language=en`
- [x] `language=fr` → 400; empty file → 400
- [x] `uv run --directory services/local-stt pytest` passes
- [x] Observed per-request latency is within the benchmarked band plus decode overhead

## Risk Assessment

- **PyAV unavailable on Windows/py3.11 (High).** The only unverified assumption
  in the whole plan. Step 1 is a hard gate specifically so this fails in the
  first hour, not the last. Fallback: ffmpeg subprocess.
- **Process abort instead of exception (High).** If `preload_onnxruntime_dll()`
  is omitted or called after `import sherpa_onnx`, the sidecar dies without a
  traceback and the cause is non-obvious. Verify ordering explicitly.
- **Wrong sample rate silently degrades accuracy (Medium).** A 48 kHz array fed
  to a 16 kHz model produces plausible-but-wrong text rather than an error.
  Assert `TARGET_RATE` in the decode unit test.
- **500MB of weights committed (Medium).** Prevented by ordering Step 2 before
  Step 4.
