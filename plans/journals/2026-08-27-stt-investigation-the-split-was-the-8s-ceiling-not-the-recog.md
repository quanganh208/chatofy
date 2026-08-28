---
title: 'STT investigation: the split was the 8s ceiling, not the recogniser'
date: 2026-08-27
summary: Diagnosed a reported vi transcript defect into four separate problems; shipped the display-only turn merge
---

# STT investigation: the split was the 8s ceiling, not the recogniser

## What happened

User read a Vietnamese news paragraph into `/translate`. Got 2 turns, an
all-lowercase unpunctuated transcript with spelled-out numbers, two recognition
errors, and a "Who spoke?" prompt on each. saydi.ai returned one correctly
punctuated segment.

Eight observed defects turned out to be **four separate problems**, only one of
which is STT accuracy:

- **Formatting** — Zipformer-30M emits bare uppercase BPE; its entire postprocess
  is `.lower()` plus one capital. No ITN, no truecasing, no punctuation. Absent by
  construction, already recorded in `development-journey.md` §4.5.
- **Segmentation** — `MAX_UTTERANCE_MS = 8_000`.
- **Accuracy** — greedy decoding, no beam, no hotword biasing. Unmeasured.
- **The speaker prompt** — not a bug. Enrollment-free attribution was measured at
  23% EER against a 10% bar and killed.

The pivot: **the English translation was already correct.** Gemini's prompt rule 4
repairs machine-transcript artifacts, so it produced "5:00 PM" from `mười bảy giờ`.
The content survives the recogniser; only its Vietnamese rendering is missing.

## Things that were assumed and turned out false

1. **"Swap to PhoWhisper to get punctuation and numerals."** Measured this repo's
   own `benchmarks/stt/results/r1/`: PhoWhisper is all-lowercase on 50/50 with
   **zero digits**. It would fix punctuation only, at 0.332 RTF (failing the gate)
   and 972MB vs 223MB.
2. **"The benchmark's WER normalization hides the defect."** Worse than that — the
   VIVOS ground truth itself has **0/50 digits and 0/50 punctuation**. There is no
   label to score against. A correct `17:00` scores as three substitutions against
   `MƯỜI BẢY GIỜ`, so fixing ITN would make the headline 5.38% WER _worse_.
3. **"Stream the repair after the English clause so TTS start is untouched."**
   The provider buffers the whole stream; `translation-session.service.ts:336`
   gates clause-splitting on the complete result. And decisively:
   `translation-model-policy.ts:69` — "three turns in four now reuse a guess", and
   discarded speculations are dropped uncancelled. No early-forward callback can
   serve the dominant path without speaking utterances the speaker continued.
   A ~40-request bench was planned, approved, then **cancelled unrun** once this
   surfaced: it would have measured a path governing at most 25% of turns.
4. **"`cutForced` is keyed by sessionId on the client."** It is keyed by `turnId`,
   and `sessionId` is nullable — the held-then-cut turn, the common case under an
   8s ceiling, has no join key at snapshot time. Red-team caught this after I had
   already "corrected" the claim once.

## Method that worked

Transpiled the repo's real `SpeechGate` and drove it with a synthetic trace
instead of arguing from the code. Shipped config → 2 turns, first closing
`forced`. Ceiling removed or raised → 1 turn, same audio. Sensitivity sweep: a
pause must reach 500ms to split, and read-aloud commas (180–300ms) never do.

That converted "probably the ceiling" into a measurement, and corrected the
initial guess: the cut does not land at the comma. The gate arms at 7.5s, finds
no quiet block, and cuts **mid-word** at 8.0s — which better explains
`và điểm mưa lớn` → `Thời điểm mưa lớn` than a clean boundary did.

## Shipped

Phase 5, display-only turn merge. `groupTurnsForDisplay` is a pure derivation;
capture facts reach it via a new optional `onTurnCaptured` listener. No wire
change, no schema change, no VAD constant touched. The 8s ceiling stays — it
exists so a translation cannot fall arbitrarily far behind the speaker.

Three bugs caught before merge, one by my own tests and two by review:

- The merge gap measured open-to-open. A ceiling-cut turn has its neighbours'
  opens ~8s apart however continuous the speech; the interval that matters is
  close-to-open, ~130ms. As first written, the exact case the phase exists for
  would never have merged.
- The sort comparator returned 0 for a missing record — not a total order.
  Reproduced on V8: `[B(100), A(none), C(50)]` → `B, A, C`; six turns with three
  records came back entirely unsorted. `turns` is completion order, so that
  renders an utterance backwards.
- The chip read the first member blindly, hiding a confirmed attribution held by
  a later member and letting the next tap overwrite it.

Both regression tests were verified to fail without their fix.

## Decisions

- Display repair goes on a **separate fire-and-forget request to the
  `gemma-4-31b-it` bucket** — separately metered, so zero contention with the
  latency-critical flash path. Costs several-seconds-late polish; deleted six
  blockers.
- Display-fidelity set will be recorded in the user's own voice **through the
  real browser capture chain**, accepting that it is unpublishable. Clean
  close-mic corpora are what left `TAU_SUGGEST` calibrated on the wrong channel.
- Accepted the re-layout pop rather than holding segments until capture records
  land, which would tax every turn to smooth a transition on the minority cut.

## Next steps

- Phase 2 (fidelity set + zero baseline) is on the critical path to Phase 4.
- `attributionStats.tapRate` now measures label coverage, not tap effort: one tap
  confirms a whole merged group. It is documented as a tap rate and reported in
  the thesis. Deferred to chapter-writing.
- Phase 3 (offline WAV diff) still unrun — settles whether "Ghi nhận lúc" was lost
  by the capture chain or the recogniser.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
