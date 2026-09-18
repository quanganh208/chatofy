# Phase 5 — Backfill the conversation that exposed all this

## Context

Every code fix here is forward-looking. Conversation `cmu4edytm001201pcn1uh8w8d`
(`/history/f35c2816-…`) keeps the record it was saved with: 53 turns covering
0:02 to 4:15 of a 4:30 recording, missing its first utterance and its last.

## What was done

Backup first: `pg_dump` of the whole production database to the session
scratchpad, 107 KB, taken immediately before the write.

The two missing utterances were cut from the stored recording and put through
**the product's own pipeline**, not through the reference transcriber used for
the audit — the Vietnamese sidecar for `sourceText`, then
`GeminiTranslationProvider` on `gemini-3.5-flash-lite` for `targetText`, which is
the model the live path uses. The point is that the two new rows are what the app
would have produced, not a better transcript written by hand.

| Position | Media | `sourceText`                                               | `targetText`                                                            |
| -------- | ----- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| 0        | 0:00  | "Hello anh em"                                             | "Hello everyone"                                                        |
| 54       | 4:23  | "Một công việc thì đi làm gì đâu nghĩ nghĩ là nghĩ cái gì" | "It's just a job, why overthink it, what is there even to think about?" |

Inserting at position 0 meant shifting 53 rows, which the unique index on
`(conversationId, position)` will not allow in one statement. Done in a
transaction, through negatives: `p → -(p+1)`, then `-p → p`, so no intermediate
state collides.

`searchText` was computed with the same fold the store applies
(`normalizeForSearch` over `[displayText ?? '', sourceText, targetText]`), so the
new rows are findable exactly like the others. `offsetMs` is media position plus
the conversation's `audioOffsetMs` of 171, which is what puts a row under the
right point of the scrubber.

## Validation

55 rows, positions 0–54 contiguous and unique, every `offsetMs` inside the
recording, and no row out of time order.

## The honest caveat

The tail row is rougher than its neighbours: the recogniser heard "đi làm gì đâu"
where the speaker said "đi làm, có gì đâu". That is the product's own output on
that audio, which is the standard the rest of the transcript was held to — but it
is visibly weaker, and deleting the row is one statement if it reads worse than
the gap did.
