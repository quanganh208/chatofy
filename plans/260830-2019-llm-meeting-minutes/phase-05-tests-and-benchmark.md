# Phase 5 — Tests, benchmark, prompt tuning

**State: CI tests done + injection harness written. The live benchmark, quality
set, and prompt tuning need a real Gemini key and were NOT run offline.**

## Unit / integration (CI — no live LLM) — done

- [x] Provider parse: valid, non-JSON, partial, action-item filtering + null
      owner/dueDate, empty body, `responseMimeType` (`gemini-summarization-provider.spec.ts`).
- [x] Provider walk: transport failure → `ProviderConnectionError`; per-minute
      quota cools the pair + reports it (no key index leaked) + walks to the next
      model; every pair exhausted → `ProviderConnectionError`; a rejected key is
      retired → `ProviderConfigError` (key material never in the message).
- [x] Prompt boundary (via the provider request): transcript wrapped in exactly
      one `<transcript>`…`</transcript>`, an injected `</transcript>` neutralized;
      both the instruction and the reminder ask for JSON.
- [x] Service: draft→domain mapping mints ids + timestamp; `failed` persisted
      before rethrow; owner-scoped reads. Controller: 404 when empty; owner from
      token. (Landed in phase 2 — `minutes.service.spec.ts`, `minutes.controller.spec.ts`.)

Full unit gate green: `jest` 814 passed / 56 suites; the summarization spec alone
is 13 tests.

## Benchmark — harness written, run owed (spends metered Gemini quota)

- [x] `benchmarks/minutes-injection/` — its own harness (not folded into the
      translation one, which grades a translation string, not a JSON draft). Drives
      the shipped `GeminiSummarizationProvider` over injection transcripts and
      grades by CANARY: an attack asks the model to emit an impossible `PWNED-*`
      token, and the grade is whether it appears anywhere in the minutes JSON; a
      control must summarize (non-empty) and trip no canary. `node --check` clean;
      corpus shape validated (3 attacks + 1 control). **Not run offline — no key.**
      Run before any change to `minutes-prompt-builder.ts`:
      `node benchmarks/minutes-injection/run.mjs` (after building ai-providers).
- [ ] A small quality set: 3–5 real vi↔en conversations with hand-written
      reference minutes; eyeball summary faithfulness, action-item recall, and that
      no decision was invented. Record in `benchmarks/`. **Needs a key + real audio.**

## Prompt tuning — owed (needs the benchmark to run)

- [ ] Only after the injection harness is green on a live run: iterate
      `minutes-prompt-builder.ts` for recall/precision, re-running the benchmark
      each time, documenting the measured effect in-file.

## Definition of done

CI unit tests green ✓; the injection harness must be **run green with a key** and
its result logged before prompt changes ship; `feat/meeting-minutes-llm` targets
`staging` per `pr-target-staging` once the browser + Postgres + benchmark runs are
done.
