---
phase: 5
title: 'Report and verdict'
status: completed
priority: P1
effort: '2.5h'
dependencies: [4]
---

# Phase 5: Report and verdict

## Goal

Turn the measurements into a stated verdict on replacing VieNeu, and record the
comparison in `docs/development-journey.md` as thesis evidence.

**This phase modifies no production code.** It reasons about whether a swap and a
clause-splitting change would be worthwhile; it does not make either. Any change
to `services/local-tts` or `apps/api` is a separate, separately-approved piece of
work. The non-goals in `plan.md` hold through this phase as they do the others.

## Read first

- `docs/development-journey.md` — how the Kokoro-vs-Piper and
  Zipformer-vs-PhoWhisper comparisons are written up, including the
  benchmark-versus-in-service reconciliation. **The file is in Vietnamese; match
  it.** Note its header states every recorded measurement was taken on
  **Windows 11**
- `README.md` — the Local speech stack table and the model-licence table
- `benchmarks/mos/README.md` — what a naturalness claim actually requires
- `apps/api/src/modules/translate/audio/clause-splitter.ts` — what the app does
  today, and the measured gain it already banks

## Files to create / modify

- Create: `benchmarks/tts-vi/results/report.md`
- Create: `plans/reports/benchmark-260914-1135-zerotts-vs-vieneu.md`
- Modify: `docs/development-journey.md` — append the comparison, in Vietnamese
- Modify: `benchmarks/tts-vi/README.md` — summarise the outcome
- Modify: `README.md` — **only if** the verdict is to swap, or if VieNeu's
  resolved licence changes the licence table

Do **not** modify `services/local-tts/`, `apps/api/`, `benchmarks/tts/`, or
`benchmarks/stt/`.

## How significance is decided — two different rules

**For latency, RTF, TTFA:** the `r1`-versus-`r2` spread is the right guard. Two
arms whose spread overlaps have not separated.

**For WER and CER: that rule is vacuous and must not be used.** With a fixed
seed, a fixed thread count and greedy decoding, `r2` re-transcribes bit-identical
audio, so the r1/r2 spread is near zero and _any_ gap — one sentence out of
forty — would read as a clean separation. The real uncertainty is the **sentence
sample**, not the run. Use a paired test over sentences instead: per-sentence
win/loss/tie counts plus a paired bootstrap confidence interval on the WER
difference, computed from the per-sentence JSONL phase 4 emits. State in the
report that `r1` and `r2` do not constitute n=2 for a quality metric.

## Tasks & Steps

1. **Combine speed and intelligibility** into `results/report.md`: one table per
   arm carrying latency p50/p95, **latency per word** as the headline speed
   figure, RTF (labelled duration-normalized) and `audio_s_per_word` beside it,
   TTFA, underrun margin, peak RSS, load time, sample rate, WER and CER from
   both judges, with the two human-speech control rows. Sentence sets kept apart,
   `code-switch` broken out.

2. **If the two engines' speaking rates differ by more than ~10%, say so
   outright.** Past that point the RTF comparison is between prosody choices, not
   between engines.

3. **Reconcile against the vendor's claims** in a claimed-versus-measured table:
   70 ms TTFA, RTF 0.50×, WER 1.03%. Say for each whether this machine reproduces
   it. Where a claim cannot be compared — the WER, because our judge is
   PhoWhisper-small — say that rather than forcing a comparison. The vendor named
   no CPU, so an RTF gap may be hardware; this machine is an i7-11700K, 8
   physical cores, Ubuntu.

4. **Reconcile against the incumbent's recorded numbers** — VieNeu at 1402 ms p50
   in-service, 0.86–1.06 s per whole sentence in the clause-splitting table. If
   this harness disagrees, name the candidate causes **in this order**:
   1. **Windows 11 → Ubuntu.** Every recorded baseline in
      `docs/development-journey.md` was measured on Windows; this machine is now
      Ubuntu on the same CPU. That is the largest uncontrolled difference and it
      belongs first.
   2. No HTTP layer in this harness — the same gap that made Kokoro's in-service
      RTF ~28% worse than its benchmark.
   3. ONNX Runtime and thread configuration, both now recorded in the headers.

5. **State the verdict**, with three outcomes available:
   - **Swap** — ZeroTTS wins or ties on speed and wins on WER under the paired
     test, both judges agree on the ranking, and its licence position is at least
     as good.
   - **Hold** — a mixed split, most plausibly ZeroTTS winning TTFA and WER while
     sounding worse. The verdict then defers to `benchmarks/mos`, and the report
     names the exact panel question that would settle it.
   - **Keep VieNeu** — no material gain.

   "Too close to call" is a legitimate result. So is "blocked": if the two judges
   disagree on the ranking, phase 4 requires that to block rather than be
   resolved by preferring one.

6. **Weigh TTFA against what clause-splitting already banks.** The comparison
   that matters is ZeroTTS streaming against **VieNeu clause-split** — the
   configuration that ships today — not against VieNeu whole-sentence. If the
   sub-100 ms first sample holds _and_ the underrun margin never goes positive,
   say what it would let the app stop doing, and note that removing
   clause-splitting would be a separate change requiring its own gapless-playback
   check. Do not recommend making it here.

7. **Carry every honesty note into the report**:
   - PhoWhisper-**small**, not the vendor's large pair; not comparable to 1.03%
   - UTMOSv2 deliberately not measured — `benchmarks/mos/README.md` records that
     UTMOS is English-trained and not valid for Vietnamese
   - WER is intelligibility, not naturalness
   - VIVOS possible-overlap caveat, and the VIVOS casing policy
   - the conversational set is in-domain and author-chosen, and its author is
     also the person judging the outcome
   - differing sample rates, and the PCM16-over-HTTP payload cost of 48 kHz,
     since `POST /synthesize` streams WAV to a browser
   - which decoder produced the scored audio — the whole-sentence graph — and
     that adopting streaming would require re-measuring intelligibility unless
     phase 3 found the two identical
   - ZeroTTS sampling is stochastic; results hold at the recorded seed, thread
     count and ORT version, and a different seed is a different draw

8. **Record the licence position.** ZeroTTS is MIT, with the NC terms applying
   only to the ZeroBench-TTS dataset, which we do not redistribute. Set that
   against VieNeu's licence as resolved in phase 1. `README.md` already flags
   Vietnamese model licensing as a commercialization risk, so if ZeroTTS clears
   it, that is part of the verdict rather than a footnote.

9. **Append to `docs/development-journey.md` in Vietnamese**, matching the
   existing comparison sections. Record the OS change alongside the numbers, so a
   later reader does not compare them to the Windows-era figures unaware.

10. **Write the standalone report** to `plans/reports/`, unresolved questions
    last.

## Verification

```bash
cd benchmarks/tts-vi
uv run python run_benchmark.py --check-complete
uv run python score_intelligibility.py --check-complete
# all honesty notes present — fails loudly on the first miss
for note in "PhoWhisper-small" "UTMOS" "naturalness" "VIVOS" "author-chosen" \
            "sample rate" "decoder" "seed"; do
  grep -qi -- "$note" results/report.md || { echo "MISSING NOTE: $note"; exit 1; }
done
# production untouched
git diff --quiet -- ../../services/local-tts ../../apps/api ../../benchmarks/tts ../../benchmarks/stt \
  || { echo "production or sibling harness modified"; exit 1; }
```

## Success Criteria

- [x] `results/report.md` covers every arm, both sentence sets, the `code-switch` subset, and both judges with their control rows
- [x] Latency per word is the headline speed metric; RTF is labelled duration-normalized and sits beside speaking rate
- [x] WER significance uses the paired-bootstrap test, **not** the r1/r2 rule, and the report says why
- [x] A claimed-versus-measured table exists for the three comparable vendor claims
- [x] The reconciliation names Windows→Ubuntu as the first candidate cause
- [x] The verdict is stated as swap / hold / keep, with "too close to call" and "blocked on judge disagreement" both available
- [x] TTFA is weighed against **VieNeu clause-split**, not whole-sentence
- [x] All eight honesty notes appear, verified by the loop above
- [x] Both licence positions recorded
- [x] `docs/development-journey.md` carries the comparison in Vietnamese, including the OS change
- [x] `plans/reports/` carries the standalone report, unresolved questions last
- [x] `git diff` proves `services/local-tts`, `apps/api`, `benchmarks/tts`, `benchmarks/stt` are untouched

## Risk and rollback

The failure mode here is overclaiming: reporting a WER difference as a quality
verdict, reading a gap smaller than the spread as a win, or comparing ZeroTTS
streaming against an incumbent configuration the app stopped shipping. Each is
guarded by a specific rule above rather than by care. Everything in this phase is
documentation — rollback is reverting the edits.
