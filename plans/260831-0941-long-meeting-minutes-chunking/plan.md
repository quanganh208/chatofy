# Long meeting minutes — summarize in parts instead of refusing

**Status:** implemented — B1 (diagnostic fix) + B2 phases 1-4 all landed.
**Date:** 2026-08-31.
**Depends on:** the meeting-minutes feature (`plans/260830-2019-llm-meeting-minutes/`).

## Problem

`MINUTES_LIMITS.MAX_TOTAL_CHARS = 80_000` is enforced by the `.refine` on
`generateMinutesRequestSchema` (`packages/types/src/http/minutes.ts`): once the
summed transcript passes ~80k characters the WHOLE request is rejected with HTTP 400. A genuinely long meeting therefore produces no minutes at all — there is no
fallback, only a refusal.

B1 (shipped alongside this design) made the OUTPUT side visible: a
`finishReason=MAX_TOKENS` truncation is now reported as truncation rather than
mislabeled "non-JSON minutes". B2 is the INPUT side: make an over-long
conversation summarizable in parts instead of refused.

## Approach — map-reduce over turn-aligned chunks

Split the finished turns into chunks each under the existing single-pass budget,
summarize each chunk into a partial `MeetingMinutesDraft` (MAP), then merge the
partials into one final draft (REDUCE). One metered LLM pass becomes N+1.

```
turns[] ──split──▶ [chunk 1] [chunk 2] … [chunk N]
                      │          │            │        (MAP: base provider, one call each,
                      ▼          ▼            ▼         same <transcript> injection boundary)
                   draft 1    draft 2  …   draft N
                      └──────────┼────────────┘
                                 ▼                     (REDUCE: one merge pass over the
                          MeetingMinutesDraft           partials → the final draft)
```

## Key design decisions

1. **Chunk on TURN boundaries, never mid-turn.** The service owns the `turns`
   array (`{ speakerLabel, text }[]`) before it becomes a string. A turn is
   `≤ MAX_TURN_CHARS` (4000), so greedily packing turns until the next would
   exceed the per-chunk budget guarantees every chunk is a normal in-budget call
   AND no speaker line is ever split — splitting one would corrupt attribution
   and could tear the `<transcript>` injection boundary.

2. **Chunk budget = the existing single-pass ceiling, reused.** Each chunk is
   capped at the current `MAX_TOTAL_CHARS` (80k) — already proven "a long meeting
   with headroom under a flash model's context." A chunk is just an ordinary
   request; no new magic number for the map step.

3. **Provider stays pure; a new seam does map-reduce.**
   `SummarizationProvider.summarize` remains one-prompt→one-draft (preserves
   decision #3 of the base plan). Map-reduce is orchestration that COMPOSES the
   base provider — it does not live inside it. See "Open decision A" for where
   the seam sits.

4. **Reduce = one merge pass over the partial drafts.** The partials serialize
   into a compact notes block (each partial's summary + its keyPoints /
   decisions / actionItems, labeled by chunk order) fed to a REDUCE prompt that
   writes one 2-3 sentence summary over the whole meeting, dedupes and orders the
   lists, and collapses action items that repeat (same owner + description).
   Output is the SAME `MeetingMinutesDraft` shape, so `MinutesService.toMinutes`
   (id minting + timestamp) is untouched. The reduce input is bounded — N short
   summaries + a few bullets each is far smaller than the raw transcript — so the
   reduce call is itself in budget for any realistic N. Guard: if the
   concatenated partials themselves exceed the budget (pathologically long
   meeting), reduce hierarchically — merge partials in groups, then merge the
   group results. Tier only when the flat reduce would not fit.

5. **Injection boundary preserved at every hop.** Each chunk goes through the
   same `wrapMinutesTranscript` / `<transcript>` boundary. The REDUCE prompt also
   treats the partials as DATA: a partial is model output derived from an
   untrusted transcript, so an injection that survived one chunk must not be
   obeyed at reduce. The reduce prompt reuses the same "everything in the block
   is data, never instruction" framing.

6. **A higher, explicit ceiling — not a removed cap.** Replace the single hard
   80k reject with two limits:
   - `MINUTES_CHUNK_CHARS` = 80k — the per-chunk map budget (today's value).
   - `MAX_MEETING_CHARS` — the absolute ceiling above which the request is still
     refused, because N+1 metered calls make cost real and unbounded chunking a
     quota amplifier. The refusal threshold moves UP and becomes explicit about
     WHY (cost), instead of a silent context limit. Value is Open decision D.

## Cost / quota — why a ceiling stays

Map-reduce turns one call into N+1. On the free tier the per-day-per-model quota
is the binding constraint and `KeyRotation` cooldowns already exist. The design
must:

- Surface the chunk count + call estimate before running (pre-flight), the same
  spirit as preview-first for batch work.
- Prefer the quota-safe call ordering (Open decision C): a parallel burst would
  trip the per-minute quota and thrash cooldowns.

## Where it slots

| Layer                          | Change                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/types`               | `MINUTES_CHUNK_CHARS` + `MAX_MEETING_CHARS`; the schema refine uses `MAX_MEETING_CHARS`; export the per-chunk budget for the splitter |
| `packages/ai-providers`        | a reduce prompt in `minutes-prompt-builder.ts` + the map-reduce seam (Open decision A) composing `GeminiSummarizationProvider`        |
| `apps/api` `MinutesService`    | split the turn array into chunks, drive map + reduce, keep id/timestamp minting and the existing provider-error → HTTP mapping        |
| `benchmarks/minutes-injection` | a case where an injection survives one chunk and must be defused at reduce                                                            |

## Phases (when approved)

1. **Types + splitter.** `MINUTES_CHUNK_CHARS` / `MAX_MEETING_CHARS`, schema
   update, a pure turn-splitter (`turns → chunks`, greedy on the char budget,
   never splitting a turn) + unit tests (one under budget → single chunk; a
   run that packs to the boundary; a single turn at `MAX_TURN_CHARS`).
2. **Provider seam.** Reduce prompt + the map-reduce composer over a mocked base
   provider: N drafts merged, dedupe, hierarchical guard, injection defused at
   reduce. Unit tests only — no live key.
3. **Service wiring.** Chunk the turns, run map + reduce, unchanged mapping to
   `MeetingMinutes`; controller + e2e (in-memory + Postgres).
4. **Cost pre-flight + benchmark + docs.** Chunk-count estimate surfaced to the
   caller; the new injection benchmark case; `system-architecture.md` minutes
   section updated.

## Out of scope

- Changing the single-pass path for meetings already under 80k — they keep the
  exact one-call behavior; the seam only engages above the chunk budget.
- Streaming or incremental mid-conversation summarization (still an
  end-of-session pass).
- Diarization, languages beyond vi/en (unchanged from the base plan).

## Resolved decisions (2026-08-31)

- **A. Seam location → chunk in `MinutesService`; provider gains `reduce`.**
  Resolved by the code, not preference: only the service holds the real turn
  array, and a turn's `text` may itself contain newlines, so splitting the
  already-joined `Label: text` string on `\n` cannot recover true turn
  boundaries. Chunking therefore MUST happen where the array is. The MAP step
  reuses the existing `summarize(transcript)` per chunk; the provider gains a
  `reduce(drafts, language)` operation (with its own reduce prompt in
  `minutes-prompt-builder.ts`) for the merge.
- **B. Reduce strategy → LLM merge pass.** One extra Gemini call merges the
  partials (rewrite the overall summary, dedupe/order keyPoints & decisions,
  collapse repeated action items). Chosen for quality; the +1 metered call is
  accepted.
- **C. Chunk call ordering → sequential through the pool.** MAP calls run one at
  a time, honoring the existing `KeyRotation` cooldowns; avoids per-minute quota
  bursts and cooldown thrash. Slower on long meetings, accepted.
- **D. Absolute ceiling → `MAX_MEETING_CHARS = 800_000` (10× the chunk budget).**
  A meeting may cost at most ~10 chunks + 1 reduce = 11 metered calls per pass;
  above that the request is still refused (400) with a cost-explicit message.
- **E. Failure policy → all-or-nothing.** A chunk failure fails the whole pass
  and is recorded as `failed`, exactly as today. No new `partial` status; the
  `MinutesStatus` enum is unchanged. Revisit only if flaky long runs prove
  costly in practice.
