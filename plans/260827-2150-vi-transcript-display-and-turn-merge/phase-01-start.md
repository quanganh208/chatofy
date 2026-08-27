---
phase: 1
title: 'Stream-shape gate (CANCELLED)'
status: cancelled
priority: P3
effort: '0'
dependencies: []
---

# Phase 1: Stream-shape gate — CANCELLED 2026-08-27

**Do not run this phase. It is kept as the record of why the question is moot.**

## What it was going to measure

Whether a two-field Gemini response chunks early enough that the field-1
delimiter arrives in a non-final chunk — which would let the provider forward the
English to TTS while the Vietnamese repair was still generating. ~40 requests,
20 reps × 2 arms, decision rule `p50(time-to-delimiter) ≤ 1.15 × p50(time-to-done, control)`.

The user approved the quota spend.

## Why it was cancelled

Red-team found the early-forwarding design unsound for a reason the bench would
never have surfaced. `translation-model-policy.ts:69`: "**three turns in four now
reuse a guess**, the endpoint itself rarely calls at all."

So the callback either fires from discarded speculations — which
`turn-speculation.ts:51-53` drops "unawaited and uncancelled", meaning TTS starts
speaking an utterance the speaker then continued — or it never fires on 75% of
turns while their tokens are still paid inside the speculation.

**The bench would have measured a path governing at most 25% of turns.** A GO
result would not have delivered the feature. Spending the quota to learn that was
not worth it.

Phase 4 now takes the separate-request route on the `gemma-4-31b-it` bucket,
which needs no chunk-timing answer at all.

## What survives from it

The decision rule and its arithmetic are recorded in
`plans/reports/redteam-260827-2201-vi-display-repair-plan.md` and in Phase 4's
"Why this design, and what it replaced". Worth keeping for the thesis: an
approach was designed, its load-bearing assumption was tested against the code,
and it was rejected on evidence before any quota or implementation was spent.
