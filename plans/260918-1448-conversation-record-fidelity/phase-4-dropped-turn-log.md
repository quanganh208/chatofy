# Phase 4 — A turn with no transcript leaves a trace

Status: done
Depends on: phases 1 and 3 releasing `use-streaming-translate.ts`,
`turn-pipeline.ts`, `conversation-session.ts` and
`translation-session.service.ts`.

## Context

Replaying the real gate against both production recordings found **one
unexplained mid-conversation loss in each**, and the second one settles what kind
of defect this is:

- conversation 1, 11.25–13.17s — 1.9s, marginal audio, ambiguous content.
- conversation 2, **51.00–56.16s — 5.16 seconds**, decoding as the complete
  sentence "Mình thì chỉ cần chớp mắt một cái thôi thì đã sang thứ hai rồi",
  51 seconds into a 111-second conversation, both neighbours stored.

The second rules out the hypothesis the first invited. It is not marginal audio,
so a blank recogniser result cannot explain it; it is not at either end, so
neither the start-up ordering fix nor teardown applies; it is its own block, so
no grouping rule touched it. Both losses follow a run of closely-spaced turns,
which makes the `too_many_turns` give-up proven in
`../reports/tail-diagnosis-260918-1356-conversation-tail-turn-loss.md` the only
mechanism that fits every loss across both conversations. That is a ranking, not
a proof: the refusal is inaudible in the recording and the server's own record
was never persisted — the prod api container started 2026-09-18 04:39 with
`RestartCount = 0`, holds no metrics artifact and mounts nothing.

Twelve probes of conversation 1's lost clip through the live sidecar (pre-roll
200/320/440ms × tail trim 400/500/600/700ms) returned a non-empty string every
time, so `sourceText.trim()` at `pipeline-translator.service.ts:273` is rarely
what fires. A reason primitive built around `no_speech` would cover the least
likely cause.

## Requirements

Logging only — the owner decided against a schema column this round, with the
consequence understood and accepted: after this phase the 5-second sentence is
diagnosable but still absent from the transcript.

Record, at the moment a turn is given up, enough to tell the paths apart: the
turn id, the close reason, how long the turn had been open, and the audio
duration involved. Derive the reason from `outcomeFor`
(`conversation-session.ts:1049-1067`), whose existing
`rejected | dropped | no_audio | played | error` mapping already spans every
promoted path — not from a new vocabulary invented here.

Log on both sides, because neither alone would have answered this investigation:
the client knows it gave a turn up, and the server knows why it refused one.

## Why this is worth doing on its own

Nothing records this today, and that absence is exactly why a five-second
sentence in a 111-second conversation cannot now be attributed to a cause. The
server's record proved non-durable, so the client-side line is the cheapest
durable place to put it.

## Known limits to state, not to solve

- A turn refused with `too_many_turns` is refused before any session id exists,
  so it cannot be keyed to a row even in principle.
- `turn-keyed-transcript.ts:163-167` already records the projection limit in its
  own words: a turn whose text never arrived "marks nothing — there is no row to
  mark". This phase does not change that.

## Validation

Trigger each path in tests and assert the log line distinguishes them. No change
to stored rows or to any read path.

## Outcome

Three log sites, each placed where the path is already classified rather than
re-derived:

- `conversation-session.ts`, in `abandonTurn` — the one place every client-side
  give-up passes through. Reuses `outcomeFor`, so the line names the same outcome
  the metrics row would carry, and states `sessionId=none` explicitly because "no
  session id" is the diagnostic fact about a `too_many_turns` refusal rather than
  a missing field.
- `pipeline-translator.service.ts` — a warning beside the `BadRequestException`
  when the recogniser returns nothing, carrying the language and the byte count.
- `translation-session.service.ts` — a warning beside the existing `no_audio`
  metrics row, carrying the session id and the buffered byte count.

### What the test turned up

Asserting on the log revealed that a refused turn is abandoned **twice**, by two
layers on two deadlines: the ordering layer stops waiting at 15s and reports
`stalled -> dropped`, and the pipeline stops retrying at 20s and reports
`too_many_turns -> rejected`. Both always called `abandonTurn`; the existing test
asserted only that the second one happened, so the pair had never been visible.
Nothing was changed about it — the behaviour is pre-existing and arguably correct,
since each layer is reporting its own truth — but the spec now pins both lines in
order, which is exactly the kind of thing this phase exists to make legible.

### Tests

`conversation-session.spec.ts` asserts both abandoned lines and their outcomes;
`pipeline-translator.service.spec.ts` and `translation-session.service.spec.ts`
each spy on `Logger.prototype.warn` and assert their own line, following the
pattern already used in the mail module.
