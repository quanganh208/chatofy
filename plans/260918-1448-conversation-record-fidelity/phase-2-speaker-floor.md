# Phase 2 — A short turn cannot name a speaker

Status: done — except two API service files, handed to `context` as a quoted patch (see below)

## Context

Two failures, both in `auto-attribution.ts`, both proven by replaying
`observeVoice` with the shipped constants over the real turn audio — 55/55
production labels reproduced exactly.

1. **Phantom cluster.** Turn 4 minted "Speaker 2" from a noise vector at cosine
   0.277; turns 10/11/12/38 then joined that phantom at 0.478/0.767/0.441/0.647
   while scoring 0.289/0.050/0.090/0.292 against the real speaker. Low-information
   vectors resemble each other far more than they resemble a voice.
2. **The unthresholded first mint.** `auto-attribution.ts:204`,
   `if (clusters.length === 0)`, creates cluster 0 with `score: -Infinity` and
   consults no threshold at all. The first vector of every conversation becomes
   Speaker 1 whatever it contains — which is what happened to `cmtz7fa6w…`
   ("Oh yeah, the") and `cmtzy8fob…` ("You need.").

Measured floor: **1250ms of voiced speech**, from two independent measurements —
a length sweep where the share of same-speaker clips falling below `tauNew` first
reaches 0/80, and an end-to-end replay where 1000ms still leaves the phantom.
Detail in `../reports/diarization-260918-1448-short-turn-mislabel.md`.

## Requirements

- Sidecar measures voiced duration from samples it has already decoded and
  returns it beside the vector; API forwards it as `speechMs`.
- Guard in the reducer **before** `observeVoice` is called
  (`turn-keyed-transcript.ts:625`), which covers all four exits at once including
  the unthresholded mint. Store the embedding, mark pending, skip the fold.
- Block both creating and claiming. Blocking creation alone leaves a coin-flip
  label on short turns of genuine two-speaker conversations —
  `auto-attribution.ts:136-142` already records these vectors scoring 0.51–0.53
  against a chance level of 0.50.
- **Required together, not as a follow-up:** `turn-keyed-transcript.ts:691`
  returns early on `clusters.length === 0` and its comment states the premise the
  guard falsifies. Branch on `state.embeddings` being empty instead — empty means
  the acoustic layer never ran, non-empty means it ran and placed nothing.
  Without this, `cmtzy8fob…` renders six speaker chips that never resolve.

Do not guard on the existing `audioMs`: it is buffer time and counts pre-roll,
hangover and leading silence. Position 10 has 720ms of speech in a 1540ms buffer.

## Files

`services/local-stt/` (embedder, `app.py`, tests), `packages/types` event shape,
`apps/api/src/modules/translate/session/turn-session.ts`,
`packages/realtime-client/src/state/turn-keyed-transcript.ts` and
`auto-attribution.ts`, plus specs.

## Validation

Regression case `cmtz8jtb9000001p97b9876ef`: every label identical, verified —
the turn that creates Speaker 2 is 12 words and clears the floor by a wide margin.
Replay over `cmu4edytm…` must give one cluster, zero phantom turns.

Known spec impact: `auto-attribution.spec.ts:76` defaults its embedding helper to
`audioMs=1000` and breaks under any floor; `speaker-centroids.spec.ts:53` defaults
to 2000; `translation-session.service.spec.ts:2154` asserts `audioMs > 0`.

## Implementation note — 2026-09-18

### What shipped

**Sidecar.** `services/local-stt/audio/speech_duration.py` measures speech off the
samples `/embed` already decoded, and the response carries `speechMs` beside
`vector` and `dim`. The detector is `speech-gate.ts` ported: per-frame RMS against
a noise floor that tracks the room, same margin, same floor, same adaptation
rates, 20 ms frames to match the ~21 ms blocks the browser gate is fed. Pauses
shorter than the gate's 500 ms hangover are counted as inside the turn, because
the gate has already used that number to decide the audio either side belongs to
one turn — bridging them is what keeps this in the same unit the 1250 ms floor was
measured in. Pre-roll and hangover, being silence at the ends, are not counted.

Checked against the diagnosis's own calibration set: all 55 turns of
`cmu4edytm…`, cut exactly as that report cut them. This reads a **median 0.90** of
the hand-measured span and agrees on **every one of the seven turns the report puts
under the floor**. It puts two more under as well — position 1 ("Nhiều") and
position 17 ("Tôi đề ra", which the report itself calls right on the line at
1290 ms). Both are Speaker 1 turns preceded by Speaker 1 turns, so both carry
forward to the label they already had. Being slightly stricter than the report's
unit errs in the safe direction: the sweep has 0% false mints from 1.25 s upward,
and suppression resolves by carry-forward.

**Contract.** `server.turn.embedding` gains a required `speechMs`, documented
beside `audioMs` as a different quantity rather than the same one measured
differently.

**Client.** The guard is at `turn-keyed-transcript.ts`, in front of
`observeVoice`, so all four of its exits — including the first-vector mint that
consults no threshold — are unreachable for a sub-floor turn. It stores the
vector, marks the turn pending, and leaves every centroid alone. `SPEECH_FLOOR_MS
= 1250` is defined in `auto-attribution.ts` with both measurements and the cost
stated where the number is.

The settle pass changed in the three ways it had to:

- it now asks whether any **vector** arrived, not whether any cluster exists. The
  old test's premise was the one the guard falsifies;
- a sub-floor vector is skipped in the settle `fill` too, so the turn carries
  forward instead of being placed by a vector that scores 0.51 against a chance
  level of 0.50;
- any row **still** pending after the fill is dropped — the ATTRIBUTION row, never
  the transcript row. `withoutPending` takes and returns an
  `AttributionsBySession` and the case returns `{ ...state, attributions }`, so
  `state.turns` is not reachable from it; `attributionFor` then answers the
  `UNATTRIBUTED` default and the turn renders as "Who spoke?". Two tests assert
  the rows survive, because a regression here would be silent. `fillPendingTurns` cannot
  reach a turn that has no usable vector and nothing before it to inherit from,
  which is a turn before the first one anybody was named for — and the floor made
  two shapes of that reachable, not one. The all-short conversation the phase
  named is the obvious one; a conversation that merely **opens** on a short turn
  is the other, and it is the shape `cmtzy8fob…` and `cmtz7fa6w…` actually have.
  Rows are dropped rather than written `fallback`, because a `fallback` row means
  a person decided (`unattributeTurn`) and no person did; an absent row is the
  encoding for nothing having decided.

### Verified

- **Acceptance criterion, end to end.** Replaying `observeVoice` over all 55 turns
  of `cmu4edytm…` with `speechMs` from the shipped measurement: **one cluster, zero
  turns on a phantom, no turn left unattributed.** The only five labels that move
  are exactly the five phantom turns, which now read Speaker 1 — the single
  speaker who was in fact talking.
- `pytest` for the sidecar: **48 passed** (8 new unit tests for the measurement, 2
  new on `/embed` against the real model).
- `vitest` for `packages/realtime-client/src/state`: **173 passed**. Every behaviour
  change mutation-checked separately rather than reported as one green suite —
  removing the guard fails 5 tests, restoring the old settle discriminator fails
  1, removing the settle-fill skip fails 1, and removing the pending cleanup
  fails 2. A suite that stays green under a change is not covering it.
- `vitest` for `packages/ai-providers`: **16 passed**, 4 of them new on the local
  embedding provider, which had no spec at all.
- `tsc` clean on `packages/types` and `packages/realtime-client` (the one remaining
  error there, `conversation-turns.ts` / `preRollMs`, is phase 1 mid-edit).
- `cmtz8jtb9…` was not re-measured — it stores no audio — but section 8 of the
  diagnosis closes it with something stronger than "untouched": the guard changes
  **zero of its 29 labels**. All three sub-floor rows there (positions 7, 26, 28)
  are preceded by a row carrying the same label, so carry-forward reproduces what
  they already read, and both speakers keep large above-floor populations (8 of 8
  and 18 of 21 rows at five words or more), so the roster cannot collapse. The
  Speaker-2-creating turn is 12 words, ≈2384 ms at the corpus's fastest per-word
  rate; at this measurement's 0.90 that is still ≈2145 ms, so the margin survives
  the stricter unit with room to spare.

### The API hop — half here, half handed over

`turn-session.ts` turned out to need nothing: it holds the `embedSpeaker` flag and
builds no event. The forwarding runs through four other files, none of them named
in this phase.

**Done here**, both granted on request because neither was under concurrent edit:

1. `packages/ai-providers/src/interfaces/speaker-embedding-provider.ts` —
   `SpeakerEmbeddingResult` carries `speechMs: number`.
2. `packages/ai-providers/src/providers/local-speech/local-speech-embedding-provider.ts` —
   reads it, defaulting a missing one to `0` rather than throwing: zero is under
   every floor, so an old sidecar withholds the turn instead of having it placed
   on a number nobody supplied, and it costs a label rather than the turn. That
   provider had no spec at all; it has four now, including the non-numeric case —
   `undefined < floor` is false, so an unchecked value would let exactly the turns
   the floor exists to stop straight through.

**Handed to the `context` agent** as quoted hunks, since it is writing in both:

3. `apps/api/.../services/pipeline-translator.service.ts` — `embedSpeaker` returns
   `number[] | null` and must return the whole result.
4. `apps/api/.../services/translation-session.service.ts` — emit `speechMs`.
   **This is the one compile error in the tree** and it is the intended one: the
   contract now demands the field the guard runs on. Its spec needs the same, at
   the `embedSpeaker` mock that resolves a bare array and at the assertion on the
   emitted event.

Until those land, the client withholds nothing because it receives nothing — the
embedding event fails its parse and is dropped, which leaves attribution dark
rather than wrong.

**That is not a harmless in-between state here.** The code default is
`booleanFromEnv(false)` at `apps/api/src/config/env.schema.ts:181`, but the
running production container overrides it: `docker exec chatofy_prod_api printenv`
returns `SPEAKER_EMBEDDING_ENABLED=true`, which is also the only way the sample
conversation could have carried speaker labels at all. So a partly-landed API hop
takes attribution dark **in production**, not in a disabled code path. The
direction is still the safe one, but the hop has to land completely before
anything is deployed.

### Outside the enumerated ownership, and why

- `packages/realtime-client/src/state/turn-embedding.ts` — `TurnEmbedding` had to
  carry `speechMs`, because the settle pass needs it after the event is gone.
- `packages/realtime-client/src/state/speaker-centroids.spec.ts` — two literals
  that stopped compiling. Nothing about that file's subject changed.
- `services/local-stt/README.md` — `/embed` was undocumented; added its row and a
  note on what `speechMs` measures.

### What a withheld turn looks like to a reader

Two outcomes, and which one a sub-floor turn gets depends on whether anything
before it was named.

**With a named turn before it** — carry-forward, `suggested`, a name on the chip.
This is the design's pre-existing bet (`speaker-roster.ts`) and the diagnosis's
named cost: B's short "vâng" during A's turn reads as A, under a chip that looks
like any other placement. It fires **zero times** on `cmtz8jtb9…`, the only
genuine dialogue in the corpus, because all three sub-floor rows there follow a
row carrying the same label.

**With nothing named before it** — the dropped row, `fallback`, no name. On
`/translate` the chip reads `web.translate.speakerUnknown` ("Who spoke?" / "Ai đã
nói?") in the fallback tone, where a placed turn shows a person's name; before
this change it read `speakerPending` ("Working out who…") forever. On `/history`
`toConversationTurns` stores `speakerLabel: null` and the screen composes its
localized fallback from `speakerRole`. Visibly unnamed on both, and not
confusable with a placement.

**No new way to lose a row.** `toConversationTurns` drops a block on one
condition only — the recognizer produced no text for it — which reads `sourceText`
and `displays`, not `attributions`. Attribution cannot discard a row at any point
in that projection. Grouping is unaffected too: `display-groups.ts` splits on
`isRendered`, which is false for `pending` and false for an absent row alike, so
the blocks a settle produces are identical either way.

### Carried for phase 1

The three additive `preRollMs` hunks landed in `turn-keyed-transcript.ts` in this
pass — the optional field on `TurnCapture`, the same on the
`transcript.turnCaptureRecorded` action, and the one line in the reducer case that
stores it — because one agent has to write that file rather than two. They are
independent of everything above. `tsc` on `packages/realtime-client` is now fully
clean; `conversation-turns.ts(183,48)` was the last error in it.
