# Conversation record fidelity

Four defects found by measuring one production conversation
(`cmu4edytm001201pcn1uh8w8d`) against its own recording, then generalised across
the other eleven stored conversations. Diagnosis reports are in
`../reports/`: `timeline-260918-1448-offset-bias.md`,
`diarization-260918-1448-short-turn-mislabel.md`,
`fragments-260918-1448-grouping-and-dropped-turns.md`.

## Outcome

The stored record of a conversation says what was said, by whom, and when. A row
seeks to audio it actually contains; a filler word does not invent a speaker; a
hesitation mid-sentence does not produce a translation made of two-word
fragments; and a turn that produced no transcript leaves a trace somebody can
diagnose.

## Constraints

- `SpeechGate` behaviour does not change. It was measured correct and the
  fragments are the speaker hesitating, not the gate misfiring.
- `display-groups.ts` keeps its `cutForced` requirement. Relaxing it was measured
  unsafe: a 213ms break to thank a donor by name is indistinguishable from a
  213ms mid-sentence hesitation.
- `greedy_search` stays the STT default (journey 3.10) and the hotwords work
  already in the tree is not touched.
- Any production data change is backed up with `pg_dump` first.
- `cmtz8jtb9000001p97b9876ef` is the one genuine two-speaker conversation and is
  the regression case for phase 2; every label must stay identical.

## Non-goals

- No STT accuracy work, no decoder change.
- No backfill of existing rows' `offsetMs` (only two conversations have
  recordings at all; deferred, needs its own decision).
- No schema column for failed turns this round — logging only, by decision,
  re-confirmed after the second recording showed the losses are more frequent
  than first believed. The accepted consequence is that a lost utterance becomes
  diagnosable without becoming readable.
- The 85 ppm capture-clock drift stays uncorrected: ~1s at the three-hour cap,
  two orders under the one-second floor `formatOffset` already imposes.

## Phases

| #   | Phase                                                                                   | Owns                                                            | Depends on |
| --- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------- |
| 1   | [Timestamp points at the turn's own audio](phase-1-preroll-offset.md) — **done**        | `realtime-client` capture/turn/offset path                      | —          |
| 2   | [A short turn cannot name a speaker](phase-2-speaker-floor.md) — **done**               | `local-stt`, `types`, api turn session, `realtime-client` state | —          |
| 3   | [Translation sees the sentence it is inside](phase-3-translation-context.md) — **done** | `ai-providers` gemini prompt path, api translate services       | —          |
| 4   | [A turn with no transcript leaves a trace](phase-4-dropped-turn-log.md) — **done**      | client abandon site + api translate services                    | 1, 3       |
| 5   | [Repair the hand-backfilled tail row](phase-5-tail-row-repair.md) — **done**            | production data                                                 | —          |

## Acceptance criteria

- Seek error re-measured on both production recordings; every row's timestamp
  lands at or before the first sample its own audio contains.
- Replaying `observeVoice` over `cmu4edytm…` yields one cluster and no phantom
  speaker; `cmtz8jtb9…` yields byte-identical labels to today.
- No conversation renders a speaker chip that never resolves.
- A fragment's translation is produced with the preceding finished utterances in
  the prompt, and the prompt-injection benchmark is re-graded, not assumed.
- A turn that ends with no transcript is recorded in the server log with enough
  to tell `no_audio` from a blank recogniser result.
- `pnpm lint`, `pnpm typecheck` and the full test suites pass.

## Result

All five phases are done and the tree is green: `pnpm typecheck` 16/16,
`turbo run test` 15/15 tasks (api 1067, web 963, realtime-client 373,
ai-providers 16), `pnpm lint` 0 errors, sidecar pytest 48.

Measured against the acceptance criteria:

- **Seek error** on conversation 1 moved from +217ms to **−79ms**, on the
  recoverable side of the rule at `transcript-time.ts:26`, with no row clamped to
  zero and all offsets still distinct. Gated by a parity case proven to fail
  without the correction.
- **Attribution** replayed over all 55 turns of `cmu4edytm…` gives one cluster,
  zero phantom turns and nothing left unattributed; the five wrong labels are the
  only ones that move. The regression case `cmtz8jtb9…` changes zero labels.
- **No conversation** renders a speaker chip that never resolves — the settle
  discriminator now branches on `state.embeddings`, and the leftover-pending rule
  covers a conversation that merely opens on a short turn.
- **Translation context** re-graded the injection benchmark at **47/47 on both
  flash models** against a 42/42 baseline, with five new cases including two
  controls that fail if the feature stops working or starts completing sentences.
- **A lost turn** is now named in the log on both sides, at the site that already
  classified it.

Two criteria were amended rather than met as written, both recorded in their
phase files: the "all five boundaries translate better" criterion asked for the
wrong thing (context measurably harms long standalone rows, so two boundaries are
deliberately gated out), and the failed-turn row is logged rather than stored, by
the owner's decision, with the consequence that a lost utterance is diagnosable
without being readable.

### Deliberately not done

- Backfilling existing rows' `offsetMs`; only two conversations have recordings.
- Passing context to `live-preview.ts`: the benefit lands on provisional text the
  final pass replaces, while the cost of reading an untrusted channel is paid
  every turn.
- The 85 ppm capture-clock drift, ~1s at the three-hour cap.
- The 5-to-15-word band for carried context is unmeasured; raising the four-word
  gate requires measuring it first.
