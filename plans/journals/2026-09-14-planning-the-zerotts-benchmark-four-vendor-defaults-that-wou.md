---
title: 'Planning the ZeroTTS benchmark: four vendor defaults that would have decided it'
date: 2026-09-14
summary: 'Brainstorm then a 5-phase plan for benchmarks/tts-vi; a red-team read the zerotts source and found unseeded sampling, half the threads, a warm-up inside load_s, and two different decoders — plus the fact that the app already clause-splits.'
---

# Planning the ZeroTTS benchmark: four vendor defaults that would have decided it

## What happened

Planned a CPU benchmark of **ZeroTTS** (zeroweight-ai, released 2026-08-19) against
**VieNeu-TTS v3 Turbo**, the Vietnamese voice `services/local-tts` ships today. Brainstormed
the contract, then wrote `plans/260914-1135-benchmark-zerotts-vs-vieneu/` — a new standalone
harness at `benchmarks/tts-vi`, following the convention in
`benchmarks/tts/tts_bench/measure.py` that benchmark projects stay independent.

No code written, no measurement run yet.

ZeroTTS checks out as a real candidate: ~903 MB of ONNX weights on HF, not gated, MIT,
`pip install zerotts`, CPU-only and torch-free for synthesis, 8 Vietnamese presets, 48 kHz.
Only the voice _encoder_ is withheld, which blocks cloning new voices from reference audio
but not synthesis with the presets — and the app never clones. Its claimed numbers (70 ms
TTFA, RTF 0.50×, WER 1.03%) are self-reported: every HuggingFace `model-index` entry carries
`"verified": false`, no CPU is named beside the figures, and the repo was four weeks old.

**The useful part was the red-team.** Three lenses against the drafted plan. It read the
installed `zerotts` source rather than its README, and found four constructor defaults that
each bias a benchmark silently — a run that looks completely successful and yields a
confident, wrong verdict.

## The four defaults

- **Sampling is unseeded, from the global RNG.** `np.random.random` is drawn on every
  generated frame (`synthesizer.py:304-305`) and `synthesize()` exposes no seed parameter.
  Unseeded, every latency, RTF, TTFA and WER figure is one draw from a distribution.
  Sharper for streaming: `synthesize_stream` is a _generator function_, so nothing runs at
  call time and the draws happen lazily per frame — seeding before the call rather than
  immediately before the `for` loop lets any intervening global-RNG consumer perturb the
  stream mid-generation.
- **Four threads against the incumbent's eight.** `intra_op_num_threads` defaults to 4
  (`synthesizer.py:61-68`) where VieNeu is constructed with 8. A ~2× CPU handicap on the
  challenger, invisible in the output, because `decode_params` would have printed 8.
- **`warmup=True` folds a dummy inference into `load_s`** (`synthesizer.py:139-140`), which
  VieNeu's construction has no equivalent of — and the vendored harness then runs its own
  untimed warm-up, so ZeroTTS warms twice and VieNeu once.
- **The two entry points decode through different graphs.** `synthesize()` runs
  `moss_audio_tokenizer_decode_full.onnx`; `synthesize_stream()` runs the ring-buffered
  KV-cache `moss_audio_tokenizer_decode_step.onnx` (`codec.py:77-78`). A TTFA claim and a
  WER number would describe different audio.

Seeding alone does not buy determinism either: the sampling happens _inside_ the graph over
FP32 logits, and top-k/top-p over an autoregressive loop with in-place `seen_mask` state
turns a 1-ULP difference into a fully divergent utterance. Thread count and `onnxruntime`
version have to be pinned exactly too.

## What the repo already decided, and the draft missed

**The app already clause-splits.** `apps/api/src/modules/translate/audio/clause-splitter.ts`
splits translated text in front of the engine specifically to cut time-to-first-audio, with
measured cuts of 23–59% in its header comment. The first draft would have timed ZeroTTS
streaming against VieNeu _whole-sentence_ — overstating the incumbent roughly twofold and
handing the challenger a win it had not earned. The TTFA comparison now has four arms, and
the one the verdict must beat is VieNeu clause-split.

**Both ASR judges already have a human-speech floor on the exact 50 VIVOS utterances the
plan reuses** — PhoWhisper-vi 7.71%, Zipformer-vi 5.38% (`docs/development-journey.md`).
Free control rows that make an absolute round-trip WER interpretable, and the draft was not
using them.

**Every recorded baseline was measured on Windows 11** (`docs/development-journey.md:4`) and
this machine is now Ubuntu on the same i7-11700K. Any reconciliation against the 1402 ms
figure has to name the OS change before it reaches for the missing HTTP layer.

**The vendored orchestration loses data quietly.** `run_engine.py:79` names its result file
from the engine id alone and `report.py:51` keys results by engine alone, so the VIVOS pass
would have overwritten the conversational one in a perfectly well-formed file. Its header is
also written _after_ the loop, so a crashed arm leaves orphan WAVs and no JSONL — which the
scoring stage, walking the WAV tree, would have scored as a corpus WER over a silent subset.

## Decisions

- **No min-of-two-ASRs**, despite the vendor doing it. `min` is not a neutral operator on a
  _comparison_: it shifts the delta between the two TTS systems in a direction you cannot
  state in advance, our two judges are far less symmetric than their two large models, and it
  would destroy the human-speech floors above. Score with PhoWhisper-small, report
  Zipformer-vi as a rank-agreement column, treat judge disagreement as blocking the verdict.
- **Two significance rules, not one.** The r1/r2 spread guard is right for latency and
  vacuous for WER — with a fixed seed and greedy decoding, r2 re-transcribes bit-identical
  audio, so any gap reads as clean separation. WER uses a paired test over sentences.
- **UTMOSv2 deliberately not measured.** `benchmarks/mos/README.md` already records that
  UTMOS is English-trained; reproducing the vendor's 2.91 would reproduce a meaningless
  number.

## Cleared, not a problem

`zerotts` + `vieneu==3.3.0` + `faster-whisper` co-resolve under `>=3.11.4,<3.12` with no
`onnxruntime` or `numpy` conflict — verified against both existing lockfiles. The
`onnxruntime==1.27.0` exact pin in `services/local-tts` is a sherpa-onnx ABI pair that does
not transfer to a harness shipping no sherpa-onnx. The plan pins it anyway, for determinism
and so the incumbent is measured on the runtime it actually ships.

## Next steps

Execute phase 1. It ends at an asserting `smoke_test.py` rather than a manual check,
because three things phase 3 depends on are still unknown: whether ZeroTTS's first chunk
arrives before the full backbone forward pass (if not, the 70 ms claim is unreproducible by
construction), whether the two decoders' output actually differs, and what VieNeu's output
sample rate is — unrecorded anywhere in this repo.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
