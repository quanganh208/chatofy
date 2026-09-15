---
title: 'Orchestrate — independent Codex audit of the ZeroTTS vs VieNeu benchmark'
date: 2026-09-14
run: plans/reports/orchestrate-260914-1410/
audited: plans/reports/benchmark-260914-1135-zerotts-vs-vieneu.md
arbiter: pass with corrections
---

# Orchestrate run 260914-1410

One read-only review job dispatched to Codex, arbitrated in-session against an
independent read of the same sources.

|            |                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Jobs       | 1 success / 0 failed / 0 blocked (4 attempts, 3 provider failures)                                                               |
| Runtime    | `codex` 0.154.0, model `gpt-6-astra`, provider AgentRouter, sandbox `read-only`                                                  |
| Arbiter    | internal (coordinator session, `claude-opus-5[1m]`)                                                                              |
| Writes     | none — nothing in the working tree was modified                                                                                  |
| Checks run | headline speed figures reconstructed from `results/r2/*.jsonl`; code-switch ratios recomputed; seed-spread statistics recomputed |

## Outcome

The benchmark's **arithmetic is sound and its raw data is honest** — every
headline speed number reconstructs exactly from the raw rows. The problem is in
what the report _concludes_ from those numbers. Its central intelligibility
claim rests on a single synthesis seed, and the harness's own seed-sensitivity
script — which was run, and whose output postdates the report — measures a
spread three times larger than the gap the verdict rests on.

Codex and the arbiter found this independently and agree on it.

## Verified findings

Ordered by how much each threatens the verdict.

### 1. The intelligibility win is measured at one seed, and the seed spread swallows the gap

**Confirmed by both reviewers, independently.**

`zerotts_vi.py` reseeds to a fixed `SEED = 20260914` before every synthesis, so
both run tags produce byte-identical ZeroTTS audio — which the report itself
notes as 41/41 identical. The paired bootstrap in `metrics.py` resamples
_sentences_, not seeds. So no part of the reported evidence estimates
synthesis-draw uncertainty.

`results/seed-sensitivity/` measures it, across 8 seeds on the conversational set:

| Arm                          |         main-run seed |   mean |         range |       spread |
| ---------------------------- | --------------------: | -----: | ------------: | -----------: |
| zerotts / baotrang           | **6.98%** (best of 8) | 14.12% |  6.98 – 36.34 | **29.36 pp** |
| zerotts / quangminh          |      6.78% (4th of 8) |  8.24% |  4.31 – 17.04 |     12.73 pp |
| vieneu / Mai Anh (6 repeats) |                     — | 22.28% | 16.43 – 36.96 |     20.53 pp |

The reported female gap is 9.03–10.68 pp. The baotrang seed spread is 29.36 pp.
The script's own docstring states the decision rule: _"A spread of the same order
as the gap means the gap is not a property of the engines and no verdict can rest
on it."_ By that rule, the female arm fails.

Using across-draw means instead of the single seed, the female comparison moves
from **2.57× to 1.58×**, and the per-draw ranges overlap (ZeroTTS 6.98–36.34 vs
VieNeu 16.43–36.96).

The direction survives — ZeroTTS is still ahead on the mean for both voices — so
**HOLD remains the right call**. What does not survive is "not close",
"separates across both tags", and "naturalness is the only remaining input".

**Arbiter addition Codex did not make:** the report's robustness phrasing
contradicts the harness's own source. `metrics.py:8-12` states that the r1-vs-r2
spread is _"a vacuous one for WER — synthesis is seeded and the ASR decodes
greedily, so a second run transcribes bit-identical audio and any gap at all
would read as clean separation."_ The summary table nonetheless cites "both tags"
as separation evidence. For ZeroTTS the two tags are the same audio, so they
carry zero independent information.

**Timeline:** the verdict report was written 13:02; the seed-sensitivity
summaries landed 13:30, 13:52 and 14:07. This is unincorporated later evidence,
not concealed evidence. The plan's own acceptance box — _"WER significance
decided by a paired test over sentences, not by r1/r2 spread"_ — is still
unchecked.

### 2. VieNeu's "gapless start" is asserted, not measured

`run_engine.py` times only `engine.synthesize(parts[0], ...)` for the clause-split
arm. It never generates the later clauses, so it never checks that clause 2 is
ready before clause 1 finishes playing. ZeroTTS's streaming arm, by contrast, is
charged its worst underrun across the whole stream (+766 to +798 ms).

The TTFA table then puts VieNeu's unverified first-clause latency (842–1256 ms)
and ZeroTTS's underrun-penalised figure (910–938 ms) in the same **"gapless
start"** column and calls it a tie. Two different standards, one column.

### 3. Intelligibility is scored on audio the app does not produce

The retained and transcribed WAV is whole-sentence output; the clause-split audio
is synthesized for timing and discarded. The report states clause splitting is
what ships today. So the headline 14.8% → 5.8% WER improvement describes a path
neither engine uses in production. ZeroTTS's full-vs-stream equivalence check
does not cover VieNeu's whole-vs-clause difference.

### 4. Summary table claims a non-overlap that its own body table refutes

Row: `Synthesis speed (RTF, latency/word) | VieNeu | Yes — ranges do not overlap`.

RTF genuinely does not overlap (0.507–0.726 vs 0.782–0.799). Latency per word
fully overlaps: **0.120–0.185 contains 0.163–0.175**. The body prose gets this
right ("roughly a tie at its slower end"); the summary row bundles the two
metrics and claims separation for both.

### 5. The code-switch multiplier is wrong in both directions

Report: _"the gap is three- to five-fold and consistent across voices and tags."_
Recomputed from the report's own CER table:

|     | female |  male |
| --- | -----: | ----: |
| r1  |  6.00× | 3.03× |
| r2  |  3.81× | 2.09× |

Actual range **2.09× – 6.00×**, on a 9-sentence subset with no interval. Neither
"three-fold" as a floor nor "five-fold" as a ceiling holds, and it is not
consistent.

### 6. Voice selection is confounded with engine

ZeroTTS's two voices were picked from eight for their _"rõ ràng"_ (clear)
labels; VieNeu's were picked upstream by listening for naturalness. Selecting one
engine's voices for clarity and the other's for pleasantness, then scoring both
with an ASR, tilts the metric. Gender matching does not address this — speaker
identity remains perfectly correlated with engine. The result is valid for these
four presets, not for the engines.

### 7. Lower-severity, confirmed

- **Streaming gets no warm-up.** The single untimed warm-up calls whole-sentence
  synthesis (`decode_full.onnx`); streaming uses `decode_step.onnx`, so its first
  invocation is cold and inside the measurement. Affects one observation of 41 —
  the medians stand, but the claim of symmetric warm-up is false.
- **The completeness gate can pass a mixed run.** It compares WAV _filenames_
  against the sentence set. A `--force` rerun that dies partway leaves new and
  old WAVs interleaved in one directory and the gate accepts it. No evidence this
  occurred; the code comments acknowledge the hazard.

### 8. Suspected, not confirmed

- **Judge lineage.** The vendor tuned against PhoWhisper-**large**; the scoring
  judge here is PhoWhisper-**small**. Family-level transfer cannot be excluded
  from the available material. Zipformer rank-agreement mitigates but does not
  settle it. This is an open lineage question, _not_ evidence that either ASR saw
  either engine's output.

## Checked and clean

- Thread counts, precision (fp32 both), and device (CPU both) are matched, with
  ZeroTTS's separate codec thread knob explicitly corrected from its biased
  package default of 4 — the harness actively removes an unfairness that would
  have favoured the incumbent.
- The normalizer is applied symmetrically to references and hypotheses,
  preserves diacritics, and does not expand numbers.
- Pooled RTF is `sum(proc)/sum(audio)`, not a mean of per-sentence ratios.
- The paired bootstrap correctly resamples matched sentence indices and
  aggregates edit counts rather than averaging per-sentence rates.
- Model load is excluded from the timed region; the warm-up uses the same voice
  as the timed loop.
- The streaming underrun calculation measures consumption from first-chunk
  arrival rather than from call start, which is the correct reference point.
- **Headline figures reconstruct exactly from raw rows** (arbiter check, which
  Codex could not run — see limitations): pooled RTF 0.7817/0.7994 against a
  reported 0.782–0.799; load 3.98/4.14 against 3.98–4.14; stream TTFA p50
  138/140 ms against 138–140 ms.

## Runtime failures — three attempts lost before one succeeded

Disclosed because it cost ~120k tokens and shapes how Codex should be used here.

| Attempt | Result                     | Cause                                             |
| ------: | -------------------------- | ------------------------------------------------- |
|       1 | exit 1, 14 s, 12k tokens   | AgentRouter `responses` cross-resource item error |
|       2 | exit 1, 0 s                | `wire_api = "chat"` removed in Codex 0.154.0      |
|       3 | exit 1, 144 s, 106k tokens | same cross-resource error, deeper into the audit  |
|       4 | **exit 0, 255 s**          | single-turn run, sources embedded in the prompt   |

The provider error is:

```
OpenAI Responses bad request: The requested item was created under a different
*** OpenAI resource. Use the same resource that created the item to access it.
```

AgentRouter load-balances across backend resources, and Codex's `responses`
protocol references items stored on whichever backend created them. A two-turn
probe succeeds on both `gpt-6-astra` and `gpt-5.6-sol`; a ~40-turn agentic audit
does not. The fault is probabilistic per request, so **failure probability grows
with session length**. `wire_api = "chat"` is gone in 0.154.0 and
`disable_response_storage` is not a recognized key, so neither protocol
workaround is available.

**Practical rule for this setup:** give Codex single-turn work with context
embedded in the prompt. Long agentic Codex sessions on AgentRouter are unreliable
and expensive to retry.

`ak orchestrate` process supervision was unavailable — it is Darwin-only and this
machine is Linux — so jobs ran as coordinator-owned subprocesses under external
`timeout`. A coordinator interruption would have orphaned the Codex process with
no supervisor to reconnect to.

## Arbiter checklist

- Required artifact produced: yes, `review-zerotts-benchmark/result.md`.
- Failures/timeouts: three provider failures, all preserved under `attempt-*/`
  with diagnoses; no timeout.
- Contradictions between outputs: none. Both reviewers independently reached the
  seed-variance finding as the top issue.
- Checks run: three, all by the arbiter, all listed above.
- Claims supported by evidence: every "confirmed" finding is anchored to a source
  line or a recomputed number. Codex's one lineage finding is correctly marked
  suspected. One Codex citation has a malformed path
  (`benchmark-260914-1135-zerotts-vieneu.md`, missing `vs-`) — a typo, not a
  substantive error.
- Routes met capability and risk floors: yes; C3 judgment work on a live-verified
  runtime, read-only sandbox, no destructive actions.
- Destructive actions: none.

## Limitations

The embedded-prompt mitigation that made the job succeed also narrowed it. Codex
did not receive `results/r2/*.jsonl` or the four test files, so it could not
audit raw-row reconstruction or test quality. The arbiter ran the raw-row check
directly (clean, above); **test-suite quality remains unaudited by either
reviewer.**

The arbiter is the coordinator session rather than an independently configured
reviewer. Auditor and arbiter are cross-family, so the cross-check on Codex's
findings is genuine; the arbiter's own additions are not externally reviewed.

## Unresolved questions

- Should the verdict report be revised to incorporate the seed-sensitivity
  evidence, or is that already the intended next step given the summaries
  postdate it by 30–65 minutes?
- Is a per-seed paired bootstrap worth running, so the intelligibility claim
  carries an interval over synthesis draws rather than over sentences alone?
- Should intelligibility be re-scored on clause-split audio, given that is the
  path that ships?
- Does VieNeu's clause-split arm stay gapless through clause 2 onward, or does
  the TTFA tie need re-measuring against the same standard applied to ZeroTTS?
- Is the four-preset voice confound acceptable for a swap decision, or should
  each engine be measured across more of its voices?
