---
phase: 1
title: 'Harness and engines'
status: completed
priority: P1
effort: '4h'
dependencies: []
---

# Phase 1: Harness and engines

## Goal

Stand up `benchmarks/tts-vi` as a standalone `uv` project in which both engines
load and produce a real WAV **under a configuration that makes them comparable**,
and settle the facts measurement cannot settle for us: which ZeroTTS presets to
use, and what licence VieNeu ships under.

> **This phase is where the comparison is won or lost.** The ZeroTTS engine spec
> below was rewritten against the package source after a review found four
> defaults that each silently bias the result: unseeded sampling, 4 threads
> against VieNeu's 8, a warm-up folded into load time, and two different decoder
> graphs behind the two entry points. Every one of them produces a confident,
> plausible, wrong verdict from a run that looks successful. Do not take the
> upstream README's word for any constructor argument — read
> `synthesizer.py` and `codec.py` in the installed package.

## Read first

- `benchmarks/tts/README.md`, `benchmarks/tts/pyproject.toml` — harness conventions
- `benchmarks/tts/tts_bench/measure.py` — `latency_stats`, `PeakRssSampler`,
  `load_sentences`, `bench_threads`
- `benchmarks/tts/tts_bench/run_engine.py` — note the untimed warm-up at 45-46
- `services/local-tts/engines/vieneu_vi.py` — the incumbent's construction, its
  `mode`/`precision` pinning, and the docstring recording that the model is
  **fetched on construction**
- `services/local-tts/pyproject.toml` — `vieneu==3.3.0`, `onnxruntime==1.27.0`
- In the installed `zerotts` package: `synthesizer.py`, `codec.py`, `hub.py`

## Files to create

- `benchmarks/tts-vi/pyproject.toml`
- `benchmarks/tts-vi/README.md`
- `benchmarks/tts-vi/.gitignore`
- `benchmarks/tts-vi/uv.lock` (**committed** — the deliverable is numbers, so the
  resolved versions are part of the result)
- `benchmarks/tts-vi/tts_vi_bench/__init__.py`
- `benchmarks/tts-vi/tts_vi_bench/measure.py` (vendored)
- `benchmarks/tts-vi/tts_vi_bench/engines/base.py`
- `benchmarks/tts-vi/tts_vi_bench/engines/vieneu_vi.py`
- `benchmarks/tts-vi/tts_vi_bench/engines/zerotts_vi.py`
- `benchmarks/tts-vi/scripts/download_models.py`
- `benchmarks/tts-vi/scripts/audition_voices.py`
- `benchmarks/tts-vi/scripts/smoke_test.py`
- `benchmarks/tts-vi/tests/test_measure.py`

Do not modify `services/local-tts`, `benchmarks/tts`, or `benchmarks/stt`.

## Tasks & Steps

1. **Scaffold the uv project.** `requires-python = ">=3.11.4,<3.12"`.
   Dependencies, **pinned exactly** where the pin affects a number:
   - `zerotts==0.1.2` — a 0.1.x package with no semver promise; an unpinned
     0.1.3 landing mid-plan changes what was measured
   - `vieneu==3.3.0` — matches the sidecar
   - `onnxruntime==1.27.0` — **exact, matching `services/local-tts`**. Two
     reasons: the incumbent must be measured on the runtime it ships, and ORT's
     graph optimization changes numerics across versions, which for ZeroTTS
     changes the sampled tokens themselves (see step 5)
   - `soundfile>=0.12`, `numpy>=1.26`, `psutil>=5.9`

   `scipy` and `sounddevice` arrive transitively from `zerotts`; name them in
   `README.md` along with the fact that `sounddevice` loads **PortAudio** at
   import and its Linux wheel does not bundle it. `libportaudio2` is present on
   this machine, but on a clean box `uv sync` succeeds and `import zerotts` then
   dies — so it belongs in the prerequisites, next to where the sibling READMEs
   record their native-library quirks. Do **not** install `zerotts[eval]`; that
   extra pulls PyTorch and exists only for the vendor's own scoring.

2. **Vendor `measure.py`.** Copy `latency_stats`, `PeakRssSampler`,
   `bench_threads` (env `TTS_VI_BENCH_THREADS`, default 8). **Rewrite
   `load_sentences`** to read the JSONL sets from phase 2 and take the `id` from
   the row's `id` field. The vendored version assigns ids positionally
   (`f"s{len(sentences) + 1:03d}"`), which would make conversational `s001` and
   VIVOS `s001` collide in one results tree — silent WAV-level data loss on top
   of the filename collision in phase 3.

3. **Extend the `TtsEngine` ABC** beyond the English original:
   - `synthesize(text, voice)` — voice token, since each engine runs two voices
   - `supports_streaming`, `synthesize_stream(text, voice)` yielding chunks
   - `decode_params()` must return everything needed to reproduce the run

4. **Write the VieNeu engine.** `Vieneu(mode="v3turbo", precision="fp32", threads=bench_threads())`.
   The fp32 pin is not incidental — `services/local-tts/engines/vieneu_vi.py`
   records that fp32 is the graph the shipped voices were auditioned on.
   Voices: `Mai Anh`, `Thanh Bình`. `supports_streaming = False`.
   `decode_params()` records mode, precision, threads, and package version.

5. **Write the ZeroTTS engine — against the source, not the README.** Five
   things the defaults get wrong for a benchmark:

   **(a) Threads.** `ZeroTTS.__init__` defaults `intra_op_num_threads=4`, with a
   separate `codec_intra_op_num_threads`. Left alone, the challenger runs on half
   the CPU of the incumbent and the header still prints 8. Pass **both**
   explicitly from `bench_threads()`, and record them as **two separate fields** —
   the codec decoder is its own session and the streaming path's cost lives there.

   **(b) Warm-up.** `__init__` defaults `warmup=True` and calls `self.warmup()`
   at the end of construction, pushing a dummy inference through every hot-path
   session. That lands inside `load_s`, which VieNeu's construction does not
   have — and the harness then runs its _own_ untimed warm-up sentence, so
   ZeroTTS would warm twice and VieNeu once. Construct with `warmup=False` and
   let the harness's existing warm-up serve both engines identically.

   **(c) Seeding.** The model samples from the **global** `np.random` on every
   generated frame (`np.random.random` inside `_local_decode_frame`), and
   `synthesize()` exposes no seed parameter. Unseeded, every latency, RTF, TTFA
   and WER figure is one draw from a distribution. Call `np.random.seed(<fixed>)`
   immediately before each synthesis.

   For streaming this is sharper than it looks: `synthesize_stream` is a
   **generator function**, so nothing executes at call time — not even voice
   resolution — and the draws happen lazily per frame as the consumer iterates.
   Seeding before the call rather than immediately before the `for` loop lets any
   intervening global-RNG consumer perturb the stream mid-generation. **Seed
   immediately before iteration**, keep the harness free of other global-RNG
   consumers, and record in `decode_params()` both the seed and that it was
   applied at iteration start.

   **(d) Weight resolution.** `from_pretrained("zeroweight-ai/ZeroTTS")` takes a
   _repo id_, and `resolve_model_dir` uses a local directory only when the
   argument **is** that directory — given a repo id it calls `snapshot_download`
   into the HF cache and ignores `models/` entirely. So a `download_models.py`
   that fetches into `models/` would download 903 MB twice and record a revision
   the run never used. Pick one and make it coherent: download into
   `models/zerotts` pinned to an exact **commit sha** and pass the **path** to
   `from_pretrained`. A sha, not a tag or branch — tags move on the Hub, so "an
   exact revision" is otherwise satisfiable by something that is not a pin.
   The package's own `hub.py` carries a docstring explaining this exact failure.

   **(e) Sampling parameters.** Record `text_temperature`, `audio_temperature`,
   `audio_topk`, `audio_topp`, `cfg_scale`, `audio_repetition_penalty`, the seed,
   both thread counts, the package version, and the weights sha in
   `decode_params()`. Never use `voice=None` — upstream warns the unconditional
   voice is unstable across runs.

6. **Write `download_models.py`.** Fetch ZeroTTS weights to `models/zerotts` at
   the pinned sha. **Also pre-warm VieNeu** — construct it once and discard — so
   both arms start from a populated cache. Without this, VieNeu's `load_s`
   contains a model download on a cold cache and a `huggingface_hub` etag
   round-trip even on a warm one, while ZeroTTS loads from a local path. That
   asymmetry is the more dangerous case precisely because it looks like a clean
   warm-start measurement.

7. **Audition the ZeroTTS presets.** `audition_voices.py` synthesizes the same
   few sentences with all eight — `baotrang`, `giahuy`, `hamy`, `huuduc`,
   `kimoanh`, `maichi`, `quangminh`, `tiendat` — into `results/audition/`.
   Listen, pick one female and one male, record **why** in `README.md`. This
   mirrors how both incumbent voices were chosen.

8. **Resolve VieNeu's licence.** `README.md` records it only as "see upstream".
   Check PyPI, the upstream model card, and any `LICENSE` inside the installed
   package; write the finding into `benchmarks/tts-vi/README.md`. If it is
   non-commercial, say so plainly — it changes what the phase 5 verdict can
   claim, since ZeroTTS is MIT.

9. **Write `scripts/smoke_test.py`** as a committed script with assertions, not
   a manual check. It must prove, with exit codes:
   - both engines load and write a playable Vietnamese WAV per voice
   - ZeroTTS streaming yields **more than one** chunk for a normal sentence
   - **whether the first chunk arrives before the full backbone forward pass.**
     If it does not, the vendor's 70 ms claim is unreproducible by construction
     and phase 3's TTFA pass measures something other than what phase 5 weighs.
     Settle this here, before phase 3 is written.
   - **the two ZeroTTS decode paths differ**: `synthesize()` runs
     `moss_audio_tokenizer_decode_full.onnx`, `synthesize_stream()` runs the
     ring-buffered KV-cache `moss_audio_tokenizer_decode_step.onnx`. Record
     whether their output differs for the same seed and text, and by how much.
     Phase 3 writes WAVs from one and times the other, so the report must know.
   - the same seed twice produces a byte-identical waveform, confirming step 5(c)
   - VieNeu's actual output sample rate, written to `README.md`

10. **Write `tests/test_measure.py`** — pure-function coverage of
    `latency_stats` and the rewritten `load_sentences`, including that it reads
    the `id` column rather than assigning positionally.

## Verification

```bash
cd benchmarks/tts-vi
uv sync
! grep -q 'name = "torch"' uv.lock          # torch must not be in the lock
uv run python scripts/download_models.py
HF_HUB_OFFLINE=1 uv run python scripts/smoke_test.py
uv run python scripts/audition_voices.py
test "$(ls results/audition/*.wav | wc -l)" -ge 8
uv run pytest
```

## Success Criteria

- [x] `uv.lock` is committed and contains no `torch`
- [x] `onnxruntime` and `zerotts` are pinned exactly
- [x] `smoke_test.py` passes, proving: both engines write playable WAVs; streaming yields >1 chunk; same seed gives byte-identical output
- [x] Whether ZeroTTS's first chunk precedes the full forward pass is recorded
- [x] Whether the streaming and non-streaming decoders produce different audio is recorded
- [x] ZeroTTS is constructed with both thread counts set, `warmup=False`, a fixed seed, and a sha-pinned local weights path
- [x] `decode_params()` for both engines records package version; ZeroTTS additionally records seed, both thread counts, all sampling parameters, and the weights sha
- [x] `download_models.py` pre-warms VieNeu so both arms start warm
- [x] One female and one male ZeroTTS preset chosen, with the reason in `README.md`
- [x] VieNeu's licence and actual sample rate are recorded in `README.md`
- [x] `libportaudio2` named in README prerequisites
- [x] `uv run pytest` passes

## Risk and rollback

The single largest risk is trusting the upstream README over the source; the
review that rewrote this phase found four biasing defaults that way. The smoke
test exists so every assumption phase 3 depends on is proven by an exit code
before any measurement code is written. Rollback is deleting
`benchmarks/tts-vi/`; nothing outside it has been touched.
