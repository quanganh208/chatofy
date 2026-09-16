# tts-vi benchmark harness

Measurement-only harness comparing **ZeroTTS** against **VieNeu-TTS v3 Turbo**,
the Vietnamese voice `services/local-tts` ships today. Standalone `uv` project,
not part of the pnpm workspace — same convention as `benchmarks/stt`,
`benchmarks/tts`, `benchmarks/mos`, `benchmarks/realtime`.

Separate from `benchmarks/tts`, which is the **English** slot's harness: its
`TtsEngine` is documented as such, its engines are hardcoded, and its tracked
results are the recorded evidence behind a decision already shipped.

## Engines under test

| Engine       | Model                     | Runtime                       | Voices measured         | Licence        |
| ------------ | ------------------------- | ----------------------------- | ----------------------- | -------------- |
| `vieneu-vi`  | VieNeu-TTS v3 Turbo, fp32 | `vieneu` (ONNX, CPU)          | `Mai Anh`, `Thanh Bình` | **Apache-2.0** |
| `zerotts-vi` | ZeroTTS 202M, fp32        | `zerotts` (ONNX Runtime, CPU) | `baotrang`, `quangminh` | **MIT**        |

Both are torch-free. `zerotts[eval]` would pull PyTorch, but that extra exists
for the vendor's own scoring and is deliberately not installed — `uv.lock` is
checked for `torch` in the verification below.

### Licences — the question this benchmark was partly meant to answer

The root `README.md` recorded VieNeu's licence only as "see upstream", and
flagged Vietnamese model licensing as a commercialization risk. Resolved here:
the `vieneu` package is Apache-2.0, and the **weights** at
`pnnbao-ump/VieNeu-TTS-v3-Turbo` are Apache-2.0 as well, with the model card
stating that audio generated with the bundled preset voices "may be used in
commercial and monetized content".

So **licence does not separate these two engines.** ZeroTTS being MIT is not an
advantage over an Apache-2.0 incumbent. ZeroTTS's ZeroBench-TTS _dataset_ is
CC-BY-NC-4.0, but that covers the dataset only and we do not redistribute it.

The rank-agreement judge (Zipformer-30M) is CC-BY-NC-ND-4.0 — academic and
measurement use only, which is what this is.

## The four ZeroTTS defaults this harness overrides

Written against the package source, not its README. Each of these silently
biases a benchmark, and each is invisible in the output it corrupts:

| Default                               | Effect if left alone                                                            | What we do                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `intra_op_num_threads=4`              | Challenger runs on half the incumbent's CPU                                     | Pass 8, and `codec_intra_op_num_threads=8` — the codec is a separate session                                                                                  |
| `warmup=True`                         | A dummy inference lands inside `load_s`, and the harness warms it a second time | `warmup=False`; the harness's own untimed warm-up serves both engines                                                                                         |
| Unseeded global `np.random` per frame | Every figure is one draw from a distribution                                    | `np.random.seed()` immediately before each synthesis, from one shared `measure.SEED` — seeding one of two compared engines manufactures a reproducibility gap |
| Lazy generator in `synthesize_stream` | Seeding before the call leaves the stream open to any other RNG consumer        | Seed immediately before iteration, and record that it was                                                                                                     |

Seeding is necessary but not sufficient for bit-reproducibility: sampling
happens _inside_ the graph over fp32 logits, and top-k/top-p over an
autoregressive loop turns a one-ULP difference into a divergent utterance. So
`onnxruntime` and the thread count are pinned exactly, and results hold only at
the recorded seed, threads and runtime.

## Findings from `scripts/smoke_test.py`

Established before any measurement code was trusted:

- **Both engines output 48 kHz.** There is no sample-rate difference between
  them, so no resampling question and no payload-size difference over HTTP.
- **ZeroTTS's first streamed chunk genuinely precedes the full forward pass** —
  ~130 ms against ~3.6 s whole-sentence on a long sentence, over 7 chunks. The
  vendor's time-to-first-audio claim is structurally reproducible.
- **The two ZeroTTS decoders agree.** `synthesize()` runs
  `decode_full.onnx` and `synthesize_stream()` the ring-buffered
  `decode_step.onnx`, but their output matches within a **1.55e-06** peak delta
  at equal length — inaudible. So intelligibility measured on the whole-sentence
  path transfers to the streamed one, and no third scoring arm is needed. The
  same holds for VieNeu, whose `infer_stream` differs from `infer` by at most
  **1.5e-06** with identical acoustic tokens.
- **A seeded run reproduces bit-identically**, on both engines, across tags and
  across processes: 41/41 on the conversational set, 50/50 on VIVOS.

## Voice selection

`scripts/audition_voices.py` renders all eight ZeroTTS presets on a short, a
medium and a code-switched sentence into `results/audition/`.

The two measured are the manifest's **"rõ ràng" (clear)** pair — `baotrang`
("trưởng thành, tin tức, rõ ràng, trung tính") and `quangminh` ("trẻ, tin tức,
rõ ràng, dứt khoát"). That register is what this product needs: a voice
translator reads back short conversational utterances where being understood is
the whole job. The other six carry prosody built for something else — four are
"kể chuyện" (storytelling), `hamy` is "hoạt hình" (cartoon), `tiendat` is
high-energy commentary.

VieNeu's pair is the one `services/local-tts` already ships, unchanged.

## Sentence sets

| Set              |   n | What it is                                                                                                                 |
| ---------------- | --: | -------------------------------------------------------------------------------------------------------------------------- |
| `conversational` |  41 | Authored for this benchmark in the register the app emits. **The verdict rests on this one.** 9 rows tagged `code-switch`. |
| `vivos`          |  50 | Built from `benchmarks/stt/data/manifest-vi.jsonl`, the same utterances the STT harness measured. Comparability only.      |

Two policies, both stated in the data files themselves:

**Orthography.** Authored `text` spells every numeral and time out in Vietnamese
words. The scorer's normalizer leaves numbers as written by design, so a digit
in a reference costs word errors for a rendering that was in fact correct —
`benchmarks/stt/README.md` documents the failure with a worked example. The
build check enforces it.

**VIVOS casing.** References keep the corpus's ALL CAPS; `text` is sentence-cased
for synthesis, because ZeroTTS reads raw orthography with no G2P stage and no
caller ever sends shouted text. The normalizer lowercases both sides.

**VIVOS caveat.** ZeroBench-TTS redistributes VIVOS, so ZeroTTS may have seen
this material. That is why it is the secondary arm.

## Metrics

**Speed** — per-sentence latency mean/p50/p95, **latency per word** as the
headline, RTF as a duration-normalized secondary, and `audio_s_per_word` beside
it. RTF is invariant to sample rate but _not_ to speaking rate: an engine that
talks 20% slower earns a 20% better RTF while making the user wait longer.

**Time to first audio**, four ways — whole-sentence, clause-split, streamed, and
the stream's **underrun margin**. The app already splits translated text at
clause boundaries in front of the engine (`clause-splitter.ts`), so the baseline
a streaming challenger must beat is _clause-split_, not whole-sentence. A fast
first chunk followed by a stream that cannot keep up is a stall, and the margin
is what makes that visible.

**Intelligibility** — ASR round-trip WER/CER. Scored by **PhoWhisper-small
alone**; **Zipformer-vi** is reported as a separate rank-agreement column and the
two are never combined. `tts_vi_bench/asr_judges.py` carries the argument against
the vendor's min-of-two protocol.

Each judge's **human-speech floor** over the same 50 VIVOS utterances is quoted
in every table — PhoWhisper 7.71%, Zipformer 5.38%, from
`docs/development-journey.md`. Without them a reader cannot tell a bad synthetic
voice from the judge's own error rate.

**Not measured: UTMOSv2.** `benchmarks/mos/README.md` records that UTMOS is
English-trained and not a valid Vietnamese naturalness predictor.

**Not measured: naturalness.** WER is intelligibility; a robotic but clearly
articulated voice scores well on it. VieNeu's voices were chosen for how they
_sound_. Every WAV is retained so `benchmarks/mos` can settle that separately.

## Significance — two different rules

For latency, RTF and TTFA, the `r1` vs `r2` spread is the guard: arms whose
ranges overlap have not separated.

For WER that rule is **vacuous**. Synthesis is seeded and the ASR decodes
greedily, so `r2` re-transcribes bit-identical audio and any gap at all would
read as clean separation. The real uncertainty is which sentences are in the
set, so WER uses a **paired bootstrap over sentences** plus per-sentence
win/loss/tie counts.

## Usage

```bash
cd benchmarks/tts-vi
uv sync
# sherpa-onnx links libonnxruntime by versioned symbol and its wheel does not
# bundle the library, so `import sherpa_onnx` fails until it is linked. Needed
# again after any `uv sync` that recreates .venv. Same fix as services/local-tts.
ln -sf "$(uv run python -c 'import onnxruntime,pathlib;print(next((pathlib.Path(onnxruntime.__file__).parent/"capi").glob("libonnxruntime.so.*")))')" \
       "$(uv run python -c 'import onnxruntime,pathlib;print(pathlib.Path(onnxruntime.__file__).parent.parent/"sherpa_onnx.libs"/"libonnxruntime.so")')"

uv run python scripts/build_vivos_set.py
uv run python scripts/download_models.py
HF_HUB_OFFLINE=1 uv run python scripts/smoke_test.py
HF_HUB_OFFLINE=1 uv run python scripts/audition_voices.py

HF_HUB_OFFLINE=1 uv run python run_benchmark.py --all
uv run python run_benchmark.py --check-complete
uv run python run_benchmark.py --render-only --report-out results/report-speed.md

uv run python score_intelligibility.py --run-tag r1
uv run python score_intelligibility.py --run-tag r2
uv run pytest
```

### Prerequisites beyond `uv sync`

`sounddevice` arrives transitively from `zerotts` and loads **PortAudio** at
import; its Linux wheel does not bundle the library. Present on this machine as
`libportaudio2`, but on a clean box `uv sync` succeeds and `import zerotts` then
fails with `OSError: PortAudio library not found`.

The rank-agreement judge reads Zipformer's weights from
`benchmarks/stt/models/zipformer-vi-30m/` rather than keeping its own copy. That
is deliberate: the recorded 5.38% human-speech floor only applies if the weights
are byte-identical, and a second copy could drift silently. Run that harness's
`scripts/download_models.py` first if the directory is missing.

`HF_HUB_OFFLINE=1` on every measured run keeps a `huggingface_hub` revision
check from landing inside a timed section, and turns a missing model into a loud
failure instead of a slow success. `scripts/download_models.py` constructs
**both** engines so neither one's `load_s` contains a download.

## Layout

```
data/            sentence sets (JSONL: id, text, ref_text, tags) + their policies
scripts/         download, smoke test, audition, VIVOS builder
tts_vi_bench/    measure, clause_split, engines/, asr_judges, metrics, report
results/<tag>/   per-arm JSONL, intelligibility, and wav/<engine>/<voice>/<set>/
```

Result files are named `{engine}__{voice}__{set}.jsonl`. All three axes are in
the name because two sentence sets share one results tree — naming by engine
alone, as the English harness does, would let the second set silently overwrite
the first.

## Outcome

**KEEP VieNeu — and stream it.**

The first run of this benchmark measured the two engines on unequal terms:
ZeroTTS seeded and streamed, VieNeu unseeded and timed as clause-split synthesis
in front of a streaming API its adapter did not use. It was redone on 2026-09-15
with both engines seeded and both streaming. `results/unseeded-baseline/` keeps
the original figures, and its README says what makes them incomparable. The
narrative account of the re-run went with the plans tree; what it concluded is
the Outcome stated here.

On equal terms, **time to gapless audio decides it**: VieNeu 221–257 ms against
ZeroTTS 937–1281 ms, with ZeroTTS underrunning on **164 of 164** streams. VieNeu
also wins RTF (0.50–0.64 against 0.87–0.98), load time and peak RAM.
Reproducibility is a tie — both engines pin bit-identically under a seed.

ZeroTTS is **more intelligible**, by a median 9–10pp with both bootstrap
intervals excluding zero, and that is now the only dimension it leads. Read the
gap from the seed sweep rather than from any single run: the shared seed lands on
ZeroTTS's best draw of eight and in VieNeu's bad tail, which is why the seeded
run shows a 22pp female gap against a 10pp median one.

Licences do not separate them: VieNeu v3 Turbo is Apache-2.0, weights included,
commercial use of preset-voice audio explicitly permitted.

Naturalness has still never been measured for either engine. `benchmarks/mos` is
now a quality baseline for the incumbent rather than the gate on a swap.

Run `analyze_variability.py` to reproduce the distribution comparison; a single
run's WER is a draw, not a measurement.
