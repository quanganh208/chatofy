# Vietnamese decoder comparison — greedy vs beam vs beam+hotwords

Plan: `plans/260827-2150-vi-transcript-display-and-turn-merge/` — Phase 6.
Run tag: `benchmarks/stt/results/r3-decoder-arms/` · 2026-08-28 · 50 VIVOS vi
utterances (558 reference words) · Linux, 8 physical cores, `num_threads: 8`,
INT8, same session for all three arms.

## Verdict

**Beam search buys nothing on this model. Contextual biasing buys 0,72 WER
points — and only when you already know the words.**

Neither result changes a shipping default; this phase measures only.

## Numbers

| Arm                                 | WER % | CER % | RTF (pooled) | p50 s | p95 s | Peak RAM | Load s |
| ----------------------------------- | ----- | ----- | ------------ | ----- | ----- | -------- | ------ |
| `sherpa-zipformer-vi-greedy` (ctrl) | 5,38  | 2,90  | 0,0158       | 0,065 | 0,088 | 211 MB   | 0,53   |
| `sherpa-zipformer-vi-beam`          | 5,38  | 2,94  | 0,0207       | 0,079 | 0,117 | 212 MB   | 0,53   |
| `...-beam-hotwords` (ceiling)       | 4,66  | 2,73  | 0,0211       | 0,084 | 0,117 | 211 MB   | 0,55   |

Deltas against the control: beam **0,00 pt WER / +0,04 pt CER** at **1,31× RTF**;
beam+hotwords **−0,72 pt WER / −0,17 pt CER** at **1,34× RTF**.

**RTF gate: every arm passes with ~14× headroom** (0,021 worst case vs the 0,3
threshold). Cost was never the reason to stay greedy — and now neither is it a
reason to move.

The control reproduces `r1`'s **aggregate** figures — WER 5,38, CER 2,90 — which is
what makes the comparison readable. It does not reproduce `r1` utterance by
utterance: **2 of 50 hypotheses differ**, in offsetting directions, which is why the
corpus WER lands on the same number twice.

```
VIVOSDEV04_R152  r1: PHỤC MỘT MÀU (correct)   ctrl: PHỤC MỘC MÀU (1 err)
VIVOSDEV10_156   r1: XÚC KIẾN KÊU (4 err)     ctrl: XÚC TIẾN KÊU (3 err)
```

Same `decode_params`, but `r1` logged 0,952 s load / 223,3 MB against this run's
0,531 s / 211,4 MB — the environment plainly differs. `r1` and `r2` are identical to
each other on all 50, so this is **cross-session drift, not per-run
nondeterminism** — and at 2 changed utterances it is the same order as the 3 the
beam arm moved. RTF drifted too: 0,0158 here against 0,0169 in `r1`, a 6,9% spread
against the 5,0% recorded between `r1` and `r2`.

Both facts point the same way: **the arms are compared to a same-session control
rather than to `r1` precisely because a cross-session difference of that size is
indistinguishable from a decoder effect.**

## What actually moved

Beam search changed **3 of 50** utterances: 1 improved, 1 regressed, 1 traded one
error for another. That is the shape of a null result, not of a small gain.

```
VIVOSDEV04_R152  1 -> 0 err   PHỤC MỘC MÀU      -> PHỤC MỘT MÀU
VIVOSDEV10_156   3 -> 4 err   CỤC XÚC TIẾN KÊU  -> CỤC XÚC KIẾN KÊU
VIVOSDEV05_119   3 -> 3 err   HOẠNH HOE         -> HOẠNH HOẸ
```

Hotwords, measured **against the beam arm** so the decoder is held constant,
changed 3 utterances: **3 improved, 0 regressed**. Every gain is traceable to a
list phrase present in that utterance's reference:

```
VIVOSDEV02_R154  1 -> 0 err   KIẾM CHÁT      -> KIẾM CHÁC      (list: KIẾM CHÁC)
VIVOSDEV05_119   3 -> 1 err   LẠNH TEA       -> LẠNH TE KIA    (list: LẠNH TE, KIA HOẠNH)
VIVOSDEV10_156   4 -> 3 err   XÚC KIẾN KÊU   -> XÚC TIẾN KÊU   (list: XÚC TIẾN)
```

That traceability is the point and the caveat at once: biasing fixed exactly the
words it was told to expect, and nothing else.

## Why the hotword number is a ceiling, not a gain

The 48-phrase list is derived from the test set's own reference texts
(`benchmarks/stt/stt_bench/hotwords.py` documents the rule: non-overlapping
adjacent syllable pairs whose syllables are corpus hapax, capped at 48 to match
the MT context block's limit). It encodes knowledge a live conversation does not
have, so **−0,72 pt is not a gain anyone would see live.**

But it is **not the ceiling either, and the arm as run cannot measure one.** 81
pairs qualify; the cap keeps the first 48 **in manifest order**, so the discarded
33 are simply the ones that appear late in the file. The consequence, measured:

| Utterances (of 50)                     | Count |
| -------------------------------------- | ----- |
| Actually carry a list phrase           | 24    |
| Would be biased if the cap were lifted | 16    |
| Never qualified a pair under any cap   | 10    |

**Sixteen utterances sat inside the "ceiling" arm as an unbiased control.** So
−0,72 pt is a **lower bound** on what an oracle list could buy, not an upper one.
Quote it as "the most **this 48-phrase list** could buy", never as the ceiling.

The 48 cap is still the right choice for a list meant to be shippable — it mirrors
`MAX_HOTWORDS = 48` in the MT prompt builder, so one vocabulary could feed both
surfaces. Measuring a true ceiling would want all 81 and is a different run.

The realistic version of this arm needs Phase 2's display-fidelity set, whose
proper nouns are a vocabulary a real user would actually supply in advance. That
run is the one worth quoting as an expected gain.

## Sample-size honesty

50 utterances, 558 reference words. A 0,72-point WER move is **4 words**. Three
utterances carry the entire hotword result and three carry the entire beam
result. The direction is clean — 3/3 improvements with zero regressions is not
noise-shaped — but the magnitude is not precise, and this set is too small to
distinguish −0,7 from −0,4.

## Phase 3 framing, unresolved

Phase 6 was to read Phase 3's verdict first. **Phase 3 has not run** — it needs a
live reproduction through the browser capture chain, which needs the user's
voice. So the question this run cannot answer stays open: whether the reported
`ngập`→`ngọt` class of error originates in the model or in the browser capture
chain (AGC, noise suppression, far-field).

What this run does add to that question: on clean close-mic VIVOS audio the
decoder is **not** the limiting factor — a 4× wider search finds nothing better.
That is weak evidence for the capture chain, not proof, because VIVOS is not the
channel the defect was observed on.

## Reproduce

```bash
cd benchmarks/stt
uv run python scripts/download_models.py        # now also writes bpe.vocab
uv run python scripts/build_hotwords_vi.py      # writes data/hotwords-vi.txt
uv run python run_benchmark.py --decoder-arms --run-tag r3-decoder-arms
```

## Changes made

- `stt_bench/hotwords.py` (new) — selection rule + the ceiling caveat, unit-tested
  in `tests/test_hotwords.py` (6 cases, incl. the non-straddling scan).
- `stt_bench/engines/sherpa_zipformer_vi.py` — three decode arms as subclasses of
  the shipping engine; `decode_params()` records the arm, and the hotword arm
  records its ceiling caveat in the result header.
- `scripts/download_models.py` — also generates `bpe.vocab` (sherpa-onnx encodes
  hotword phrases through it; the HF repo ships neither it nor `tokens.txt`).
- `run_benchmark.py` — `--decoder-arms`.
- `stt_bench/report.py` — arm licenses; run-variance rows now emit one cell per
  run tag. Adding a tag whose engine set differs previously produced a short,
  misaligned row.
- `README.md` — the decode-comparison section and its label.
- `benchmarks/stt/.gitignore` — `data/` becomes `data/*` plus one negation, so the
  48-phrase list is committed. `decode_params` records only its filename, and
  `data/` is otherwise ignored as downloaded corpora, so the input behind 4,66 WER
  was not recoverable from the repo.

**Not changed:** `services/local-stt/engines/zipformer_vi.py` still decodes
greedily. `results/r1`, `results/r2` and the shipping `sherpa-zipformer-vi`
engine id are untouched; the report's primary run is still `r1`.

## Unresolved questions

0. Were `r1`/`r2` recorded on a different OS or sherpa-onnx version? Nothing in the
   result headers or §3.5 records it, and the 12 MB / 0,42 s gap says the
   environment differs. The header should carry platform + library version so the
   next cross-run comparison does not have to guess.

1. Promote nothing, or promote hotwords once a real vocabulary exists? The
   service has no hotword plumbing today, and `buildContextBlock()` on the MT
   side is written but uncalled — one user vocabulary list could feed both. That
   is a product decision with its own phase, not a benchmark outcome.
2. Does the beam null result hold on far-field browser-captured audio? Untestable
   until Phase 2's set exists.
