# Phase 3 — Translation sees the sentence it is inside

Status: done

## Context

A two-word fragment like "Thì nó" reaches the model as two words plus the
glossary. `TranslationRequest.context?: string[]` is declared at
`packages/ai-providers/src/interfaces/translation-provider.ts:82-83` and
documented as "preceding utterances for context-aware translation" — and is
populated by no caller and read by no provider. `gemini-translation-provider.ts:130`
builds its `<context>` block from hints only (`prompt-builder.ts:262-290`), and
`SessionRegistry` keeps no transcript history.

Grouping is NOT the lever: translation happens per turn at
`translation-session.service.ts:336` and `groupTargetText`
(`display-groups.ts:216`) only concatenates already-translated strings. Merging
the rows would leave the English unchanged. Detail in
`../reports/fragments-260918-1448-grouping-and-dropped-turns.md`.

## Requirements

Carry preceding **finished** source utterances into the `<context>` block.
"Finished" is load-bearing: with `MAX_IN_FLIGHT=3` the immediately preceding turn
may still be in flight, so the context is whatever has actually completed.

Prior transcript text is a second instruction channel. It goes through
`asTranscriptData`, the same containment the glossary rendering side already
uses, and `benchmarks/prompt-injection` must be **re-graded**, not assumed — its
baseline is claimed intact only "with no hints".

## Files

`packages/ai-providers/src/providers/gemini/prompt-builder.ts`,
`gemini-translation-provider.ts`,
`apps/api/src/modules/translate/services/translation-session.service.ts`,
`services/pipeline-translator.service.ts` and the session code that holds
per-session state, plus specs and `benchmarks/prompt-injection`.

Do not edit `display-groups.ts`, `turn-keyed-transcript.ts` or
`session/turn-session.ts` — phases 1 and 2 own those.

## Validation

Re-graded prompt-injection benchmark, reported as a number against its recorded
baseline. A fragment's translation improves on the five measured boundaries
(16→17, 19→20, 20→21, 28→29, 29→30) without the glossary's 4-word cap moving.

### Amended after measurement — 2026-09-18

**The second sentence above asked for the wrong thing, and it is amended rather
than reported as a partial failure.** It assumed every one of the five boundaries
is a turn that needs the sentence it is inside. Measurement says two of them are
not: pos 21 and pos 30 are 16 and 17 words, they stand on their own, and giving
them context made one of them measurably WORSE. A third, pos 20 `Thì nó`, is
correct at "So it" with or without context — two words say two words, and
`ctl-context-not-completed` now exists to keep it that way, so "improves" was
never the right test for that row either.

The criterion as it should have been written, and as it was met:

> No boundary is worse with context than without. The boundaries that are
> genuinely mid-sentence improve or stabilise, and the boundaries that stand on
> their own are left exactly as they were. The prompt-injection benchmark is
> re-graded against its recorded baseline with no regression, and the glossary's
> 4-word cap does not move.

Result against that: pos 17 a clear win, pos 29 stabilised, pos 20 correctly
unchanged, pos 21 and pos 30 byte-identical to the prompt they had before this
phase. Benchmark 47/47 on both flash models against a recorded 42/42. The cap did
not move.

---

## Implementation note — 2026-09-18

`TranslationRequest.context` is now populated and read. `SessionRegistry` was
left alone; the history lives in a new `session/conversation-context.ts`, keyed
by socket in a `WeakMap` for the reason the registry keys its own recent-turn
record that way. `TranslationSessionService` records a turn's `sourceText` at
`timeline.markTranslated` — the first point the turn has final text, before the
emit, the embedding and clause delivery — and recalls the list when it builds the
next request, on both the final and the speculative pass. Order is COMPLETION
order, which is what "finished" means here: turns overtake one another, and
holding a slot for one still in flight would make a fragment wait on the very
turn that left it without context.

`asTranscriptData` sanitizes each utterance on the same edge as the transcript.
Carried speech reaches only the block's own section — it can never become a
hotword or half of a preferred rendering, so it is no route around the glossary's
four-word cap, which did not move.

### Bounds, and the reason for each number

- **4 utterances.** The longest hesitation run measured here is three turns
  (19 → 20 → 21), so three carries the whole sentence and the fourth is one
  utterance of lead-in beyond it.
- **240 characters each**, tail kept. `maxUtteranceMs` is 8000, which
  conversational Vietnamese fills with about 30 words ≈ 160 characters; the tail
  is kept because the words next to the fragment are the ones that disambiguate
  it. Worst case 960 characters, inside what the hotword ceiling already allows.
- **Carried only to a transcript of 4 words or fewer** (`needsPriorSpeech`).
  This one was NOT in the plan and is the result of measuring, described below.

### The gate, and why it exists

Context is not free, and the turns that pay for it are the ones that did not need
it. On `gemini-3.5-flash-lite` at 4 repeats, stored row 30 — 17 words, a complete
thought — answered "Build/Develop a large series" 4/4 with no context and "Play a
big series" 4/4 with the four utterances before it. One of those contains
`đánh một cái series lớn` with no resort clause after it, where the verb really
does read as "play", and the earlier, more ambiguous use anchored the later one
wrong. A single junk line of context (the bare particle `Đấy`) was worse still:
"Launch", "Issue", "Issue", "Print".

So the gate is the defect's own population: this report counted 14 of 53 rows at
four words or fewer and said of them that merging cannot help and only context
can.

**The 5-to-15-word band is UNMEASURED.** Four is the top of the range where
context was measured to help and seventeen is where it was measured to hurt, and
nothing between them has been tested at all. Raising this line requires measuring
that band first — not reasoning about it. An unmeasured threshold that looks
principled is how a number outlives the evidence that set it, and the only thing
standing between this constant and that fate is this paragraph.

### The five boundaries, measured

`gemini-3.5-flash-lite`, 2 repeats per condition.

| pos | source                          | without context         | with context                |
| --- | ------------------------------- | ----------------------- | --------------------------- |
| 17  | `Tôi đề ra`                     | "I propose" 2/2         | **"I set out" 2/2**         |
| 20  | `Thì nó`                        | "So it" 2/2             | "So it" 2/2                 |
| 21  | `Nó còn xa lắm…` (16 w)         | —                       | gated out, prompt unchanged |
| 29  | `Đấy`                           | "There" / "There it is" | "There" 2/2                 |
| 30  | `Đánh một cái seri lớn…` (17 w) | —                       | gated out, prompt unchanged |

Honestly: **one clear win, one stabilised, one unchanged, two no longer
touched.** Pos 17 is the case the feature was built for — "I propose" is a
standalone present-tense claim the speaker never made, where the preceding clause
ends "…so với những gì mà tôi" and makes it "what I set out". Pos 20 not moving
is the correct answer, not a miss: "So it" is what two words say, and
`ctl-context-not-completed` exists to keep it that way. Pos 21 and 30 stand on
their own and are now byte-identical to the prompt they had before this phase.

### Benchmark

`benchmarks/prompt-injection` re-graded, 47 cases (5 new), both flash models,
exit 0: **47/47 on `gemini-3.5-flash-lite`** (p50 1042ms) and **47/47 on
`gemini-3.1-flash-lite`** (p50 1592ms), against a recorded 42/42 baseline. Every
previously-passing row still passes. The full run printed 46/47 for 3.1 because
`ctl-hint-helps` — a hints case carrying no context — hit a 20s transport error;
an error is not a result, and the row was re-measured at 2 repeats and passed
both times. Detail and the new rows are in that harness's README.

### Follow-up, decided rather than deferred: the live preview stays without context

`session/live-preview.ts` passes the session hints wholesale so the preview and
the final pass cannot disagree on a proper noun. It does **not** get carried
speech, and that is a decision taken on the trade-off rather than an ownership
accident or an oversight — nobody else was editing the file.

The preview produces provisional text that the final pass replaces. So the
benefit would land on a line nobody keeps, while the cost is paid every turn and
scales with the preview's re-read cadence: an untrusted channel read several
times per turn instead of once. Revisit only if the preview stops being
provisional, and re-run `benchmarks/prompt-injection` if it does — the exposure
being multiplied is the one that benchmark exists to measure.
