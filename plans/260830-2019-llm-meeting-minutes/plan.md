# LLM Meeting Minutes — summary, key points, decisions, action items

**Status:** phases 1–4 done (contracts, API + tests, web UI, Prisma persistence — all verified offline); phase 5 CI unit tests + injection harness done, live benchmark owed. Remaining, all needing a real environment: extension overlay minutes UI (browser), Postgres db-e2e + `prisma migrate dev` validation, the live minutes-injection + quality benchmark (Gemini key), and a browser run of the web flow.
**Branch:** `feat/meeting-minutes-llm` (off `main` @ 945d448).
**Date:** 2026-08-30.

## Problem

Chatofy translates a two-person conversation turn by turn, but produces nothing
_about_ the conversation once it ends. Users want the meeting's outcome, not a
replay of every line: a short summary, the key points, the decisions reached,
and the action items owed (with owner + due date where the speakers named them).

Automatic audio **diarization** stays out of scope (it already is, in
`system-architecture.md`) — speaker identity comes from the existing
voice-embedding attribution, human-confirmed. This feature is the
**summary-after-the-fact** pass over the finished, attributed transcript.

## Approach

One LLM pass over the whole transcript, returning structured JSON. It slots into
the existing provider architecture as a new **`summarization`** kind on the
`ProviderRegistry`, so it inherits the Gemini pool/quota machinery
(`KeyRotation`, `error-classification`) rather than re-deriving it.

### Key design decisions

1. **New provider kind, not a bespoke service.** `SummarizationProvider`
   interface + `GeminiSummarizationProvider`, registered by `resolveOnly`
   (single impl, like `realtime` / `speakerEmbedding`). A second backend becomes
   a loud "choose one" error, by design.
2. **Same prompt-injection boundary as translation.** The transcript is wrapped
   in a `<transcript>` data block by the _same_ `wrapTranscript` /
   `stripTranscriptTags` helpers the `benchmarks/prompt-injection` suite already
   exercises — no second copy to drift out from under that coverage.
3. **Provider stays pure; the app mints identity.** The provider returns a
   `MeetingMinutesDraft` (semantic content only). Action-item ids and the
   generated-at instant are assigned by `MinutesService` when it maps the draft
   onto the stored `MeetingMinutes` — non-deterministic values do not belong in a
   unit whose value is being pure over its prompt.
4. **Client carries the transcript (for now).** The API keeps no transcript
   copy (the realtime-client reducer owns the turns). So `POST
/sessions/:id/minutes` carries `{ speakerLabel, text }[]`. A future
   server-held-transcript form is additive; it does not change this contract.
5. **Swappable store, in-memory default.** `MinutesStore` mirrors the
   `SessionStore` seam. `MemoryMinutesStore` now; `PrismaMinutesStore` when
   minutes must outlive a restart or be read on another instance.
6. **`MinutesStatus` keeps failure visible.** _Never generated_ (GET 404) is
   distinct from _last pass threw_ (a stored `failed` record). A provider error
   is persisted as `failed` before it is rethrown.

## Phases

| #   | Phase                                                                    | State                                   |
| --- | ------------------------------------------------------------------------ | --------------------------------------- |
| 1   | [Contracts + summarization provider](phase-01-contracts-and-provider.md) | **scaffolded**                          |
| 2   | [API minutes module](phase-02-api-module.md)                             | **complete** (mapping + tests + e2e)    |
| 3   | [Web/extension UI](phase-03-web-ui.md)                                   | **web done** (extension overlay owed)   |
| 4   | [Persistence (PrismaMinutesStore)](phase-04-persistence.md)              | **complete** (db-e2e owed on Postgres)  |
| 5   | [Tests, benchmark, prompt tuning](phase-05-tests-and-benchmark.md)       | **CI tests done** (live benchmark owed) |

## Out of scope

- Automatic audio diarization (speaker split from waveform alone).
- Languages beyond vi/en.
- Re-summarizing incrementally mid-conversation — this is an end-of-session pass.

## Verification (definition of done)

- `pnpm turbo run typecheck` green across `@chatofy/types`, `@chatofy/ai-providers`, `@chatofy/api`.
- Unit tests: provider JSON-parse (happy + malformed + partial), service draft→domain mapping, controller 404, prompt-builder boundary (transcript wrapped, tags stripped).
- `benchmarks/prompt-injection` extended with a minutes case, run by hand (metered quota), before any prompt change ships.
- Docs updated (done for the scaffold: `system-architecture.md`, `codebase-summary.md`).
