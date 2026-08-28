# stt benchmark harness

Measurement-only harness comparing STT stacks on CPU for the model decision +
thesis comparison chapter. **Not** part of the pnpm/turbo workspace and never
imported by the app — standalone `uv` Python project (same convention as
`services/local-stt`).

Research context, candidate survey, and the recorded decision:
`docs/development-journey.md`

## Stacks under test

| Stack    | vi                        | en                    | Engine         |
| -------- | ------------------------- | --------------------- | -------------- |
| A        | Zipformer-30M-RNNT-6000h  | Moonshine base        | sherpa-onnx    |
| B        | PhoWhisper-small CT2 INT8 | whisper small.en INT8 | faster-whisper |
| Baseline | ElevenLabs Scribe v2      | ElevenLabs Scribe v2  | cloud REST     |

Metrics: WER + CER (one shared normalization), RTF + latency p50/p95, peak RAM
per engine (subprocess-isolated), model load time. Decision threshold: RTF ≤ 0.3.

CER is reported next to WER because Vietnamese carries meaning in its diacritics.
A hypothesis one tone mark away from its reference loses the whole word to WER,
scoring the same as an unrelated word; CER prices that near-miss at one
character. On r1 the two metrics disagree about how far apart the vi engines
are — WER separates them by 43% relative, CER by 19% — so the vi comparison is
read on both. Both are computed from the per-utterance `ref_text`/`hyp_text`
already in `results/`, so adding CER re-reports finished runs rather than
requiring new ones.

## Setup

```bash
cd benchmarks/stt
uv sync
```

## Prepare test data (once)

```bash
uv run python scripts/prepare_datasets.py
```

Downloads VIVOS test split (vi, CC BY-NC-SA 4.0 — measurement use only) and
LibriSpeech test-clean (en, CC BY 4.0), selects 50 utterances/lang (3–10s,
seed 42), converts to 16 kHz mono WAV, writes `data/manifest-{vi,en}.jsonl`.

## Test

```bash
uv run pytest
```

## Download models (once)

```bash
uv run python scripts/download_models.py
```

Caches Zipformer-30M vi (+ generates tokens.txt and bpe.vocab from bpe.model),
Moonshine base en INT8, PhoWhisper-small CT2, whisper small.en CT2 into
`models/`. `bpe.vocab` exists only so sherpa-onnx can encode hotword phrases for
the decode-comparison arm below.

## Run benchmark

```bash
uv run python run_benchmark.py --run-tag r1            # 4 local engines
uv run python run_benchmark.py --run-tag r2            # variance-check rerun
uv run python run_benchmark.py --include-cloud ...     # + ElevenLabs baseline
```

Engines run sequentially, each in its own subprocess (isolated peak-RAM
measurement, no CPU contention).

## vi decode comparison

A separate three-arm run measuring what the decoder alone buys on Vietnamese.
Model files, quantization and thread count are held fixed; only the decoder
varies.

```bash
uv run python scripts/build_hotwords_vi.py                  # writes data/hotwords-vi.txt
uv run python run_benchmark.py --decoder-arms --run-tag r3-decoder-arms
```

| Arm                                 | Decoder                | Biasing            |
| ----------------------------------- | ---------------------- | ------------------ |
| `sherpa-zipformer-vi-greedy`        | `greedy_search`        | none (control)     |
| `sherpa-zipformer-vi-beam`          | `modified_beam_search` | none               |
| `sherpa-zipformer-vi-beam-hotwords` | `modified_beam_search` | 48-phrase hotwords |

The arms carry their own engine ids and their own run tag, so the recorded
`r1`/`r2` stack comparison is neither overwritten nor re-scored. The control arm
repeats the shipping configuration inside the same session, because comparing
against `r1` would confound the decoder with the machine and date it ran on.

**The hotword arm is a ceiling, not an expected gain.** Its list is derived from
the test set's own reference texts (`stt_bench/hotwords.py` documents the rule),
so it measures what biasing could buy if the rare terms were known in advance.
Live conversation does not grant that. Report the number with the label attached.

## Display fidelity — the metric WER cannot be

The WER table above can never credit a fix to the Vietnamese transcript's
readability, and this is structural, not a tuning oversight:

- 0 of 50 VIVOS references carry a digit; 0 carry a punctuation mark. All 50 are
  ALL-CAPS. There is no label for casing, punctuation, or numeral form.
- `stt_bench/text_normalize.py` leaves numbers as written, by design, so every
  recorded number stays comparable. A hypothesis that correctly renders `17:00`
  scores three word errors against a reference reading `MƯỜI BẢY GIỜ` (it
  normalizes to `17 00`, so two substitutions and a deletion).

So repairing the display would make the headline WER **worse** while the product
got better. `stt_bench/display_fidelity.py` is the separate measurement:
numeral recall, punctuation F1 (placement, anchored to the preceding word), and
proper-noun capitalization — scored on the raw string, with `normalize_text`
deliberately not applied.

It also counts **numeral hallucinations** — the motivating case being the failure
an over-eager inverse text normalization produces, `không phải` ("not") rewritten
to `0 phải`. Read the name loosely: it is a multiset difference, so a _reformat_
(`2/9` emitted as `2-9`) raises it too, and a reformat therefore costs both a
recall miss and a hallucination. One defect, two headline numbers — say so when
quoting the pair.

Two conventions worth knowing before writing references: a run of the same mark
counts once (`...` is one ellipsis, not three periods), and punctuation is keyed
by (preceding word, mark), so two placements after the _same_ word can collide.
That needs one word to precede marks at two positions; separating those cases
needs optimal assignment, which is far more machine than the case is worth.

Aggregation is micro (pooled counts). A metric whose reference offered nothing to
score returns `None`, never a vacuous 1.0.

```bash
uv run pytest tests/test_display_fidelity.py -q
```

**The corpus does not exist yet.** By decision (see the plan), it will be
recorded in one speaker's own voice **through the real browser capture chain** —
same AGC, noise suppression and mic distance the product ships — because a clean
close-mic set measures a channel nobody uses. That makes it an internal set: the
audio is personal data, is not committed, and the numbers are therefore not
independently reproducible. State that caveat wherever they are quoted.

Written-reference orthography is part of the ground truth, not a scoring detail:
`0,4` (Vietnamese decimal comma, and the metric treats that comma as part of the
number rather than a clause boundary), `17:00`, `2/9/1945`.

Measured motivation, on real speech rather than argued from VIVOS
(`plans/reports/capture-260828-1114-real-voice-capture-chain-vs-recognizer.md`):
one recording scored 4.3% WER against a spoken reference and 26.8% against the
written form of the same sentence — the entire 9-error gap being one date.

Render the markdown report from all run tags:

```bash
uv run python -c "from pathlib import Path; from stt_bench.report import render_report; print(render_report(Path('results')))"
```

Latest results are summarised in `docs/development-journey.md`; raw metrics stay
in `results/`. Environment:

- `STT_BENCH_THREADS` — CPU threads per engine (default 8, physical cores)
- `ELEVENLABS_API_KEY` — required only for the cloud baseline rows

Windows note: the sherpa-onnx wheel does not bundle `onnxruntime.dll`; the
engines preload the venv's copy before use so the ORT 1.17 build that ships in
`System32` cannot be picked up (that mismatch hard-crashes the process).
