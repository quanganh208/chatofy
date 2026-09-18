# Phase 5 — Repair the hand-backfilled tail row

Status: done

## Context

Position 54 of `cmu4edytm001201pcn1uh8w8d` was inserted by hand earlier and fuses
two separate utterances at a timestamp belonging to neither. Verified by
re-cutting the recording and decoding each span through the sidecar:

| span         | decodes as                                                    | belongs to                                                              |
| ------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 255.8–263.8s | "Tôi xin lỗi tôi học từ lớp mười một … có cái gì đâu mà nghi" | position 53, matches stored text                                        |
| 264.1–265.5s | "việc thì đi làm"                                             | continuation 480ms after a ceiling cut — belongs in position 53's block |
| 266.3–267.6s | "…nghĩ nghĩ là nghĩ cái gì"                                   | the separate final utterance                                            |

The independent reference transcript agrees: "…tôi đã đi thực tập rồi. Có cái gì
đâu mà nghĩ, một công việc thì đi làm, có gì đâu. Có gì đâu mà nghĩ, nghĩ là nghĩ
cái gì."

This is a defect in the hand-written repair, not in the pipeline.

## Requirements

Append the 264.1–265.5s continuation to position 53's text, and reset position 54
to the final utterance at an `offsetMs` of roughly 266300. `searchText` must be
rebuilt with the store's own fold, not by hand — see
`prisma-conversation.store.ts`.

## Steps

1. `pg_dump` the production database first, to the session scratchpad.
2. Single transaction, `ON_ERROR_STOP`.
3. Verify afterwards: 55 rows, positions contiguous 0–54, offsets monotonic.

## Risk

Production data. The backup is the rollback.

## Outcome

Applied 2026-09-18. Backup taken first to the session scratchpad as
`prod-backup-260918-1502.sql` (109,978 bytes), then a single `ON_ERROR_STOP`
transaction updating two rows.

The continuation and the final utterance were re-decoded through the production
sidecar over the gate's own spans, each with the 320ms pre-roll the pump
prepends, so the stored text is the recogniser's rather than anything phrased by
hand: 263.92–265.36s gave "Công việc thì đi làm" and 266.16–267.46s gave "Có gì
đâu nghĩ nghĩ là nghĩ cái gì". Both English strings came from the product's own
`GeminiTranslationProvider`, not from a hand translation. `searchText` was folded
with the store's `normalizeForSearch` rather than by hand, and the block members
were joined with the single space `groupRawSourceText` uses.

Position 54's `offsetMs` is 266651: the utterance opens 266480ms into the
recording, plus the conversation's `audioOffsetMs` of 171, which is the same
convention the 53 pipeline-produced rows use.

Verified after: 55 rows, positions contiguous 0–54, offsets monotonic, and
`searchText LIKE '%cong viec thi di lam%'` now matches position 53 — the phrase
was unfindable before because it sat in the wrong row.
