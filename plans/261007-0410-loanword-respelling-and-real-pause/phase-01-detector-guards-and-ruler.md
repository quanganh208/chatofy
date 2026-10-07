---
phase: 1
title: 'Structural detector, guards and offline ruler'
status: completed
priority: P1
effort: '5h'
dependencies: []
---

# Phase 1: Structural detector, guards and offline ruler

## Goal

Build pure functions that (a) find the spans of a Vietnamese transcript that cannot be Vietnamese syllables and (b) decide whether a proposed respelling of a span may reach the display. Then build a ruler that scores them offline against prod turns.

## Context

- The prototype that produced the numbers is in the session scratchpad:
  - `vi_syll.py`: onset/nucleus/coda regex over tone-stripped NFC.
  - `match.py` and `llm-arm.js`.
- Port the logic. Do not copy the prod rows: transcripts are personal data and are never committed.
- Vietnamese text helpers already live in `packages/ai-providers/src/text/vietnamese.ts`. The detector sits beside it and is exported from the package index.

## Files

- Create:
  - `packages/ai-providers/src/text/vietnamese-syllable.ts`, which exports `isVietnameseSyllable(word)` and `foreignSpans(text)` (returns `{ text, start, end }[]` of maximal runs of non-syllable, non-digit tokens).
  - `packages/ai-providers/src/text/vietnamese-syllable.spec.ts`.
  - `apps/api/src/modules/translate/services/loanword-respelling.ts`, which exports `acceptRespelling(span, proposal, translations)` and `applyRespellings(displayText, accepted)`.
  - `apps/api/src/modules/translate/services/loanword-respelling.spec.ts`.
  - `benchmarks/loanword-respelling/` holding a README, `score.mjs`, and a `.gitignore` for `data/`. It reads a locally dumped JSON of turns (`{id, src, en}`) and prints a per-span table plus right/wrong counts against a hand-adjudicated `data/truth.json`.
- Modify: `packages/ai-providers/src/index.ts` (export).

## Steps

1. **Detector.**
   - Rule: strip only the five tone marks (NFD: U+0300, U+0301, U+0303, U+0309, U+0323), keep the breve, circumflex and horn, then re-compose to NFC.
   - Match the result against onset? + nucleus + coda?.
   - The onset, nucleus and coda inventories are the closed phonotactic sets of the language. Comment them as structural, not vocabulary.
   - Tests:
     - Real syllables pass: "nghiêng", "khuya", "quốc", "gì", "xoong".
     - Garbled loanwords are flagged: "deep", "fred", "defec", "interpol", "vneid".
     - Digits are never flagged.
     - Spans are maximal ("deep fred" is one span).
2. **Guards in `acceptRespelling`.** Accept only when all of these hold:
   - The proposal is Latin script only. No Vietnamese diacritics; letters, digits, space and hyphen allowed. This rejects "đét-lai" and "héc ta".
   - The proposal differs from the span in letters, not only in case or spacing. This rejects "A mode".
   - The proposal's letters appear in the translation as a 1–3-word n-gram, ignoring case and a plural "s".
   - The letter similarity (difflib-style ratio, lowercase letters only) of span vs proposal is at least a threshold that the ruler sets. Start at 0.5, then fix it from the step 4 numbers.
   - The proposal is at most 64 characters (the existing hotword term cap).
3. **`applyRespellings`.** Replace each accepted span in the restored display by position and keep the surrounding punctuation. The test covers a span at the start of a sentence (case of the first letter), a span right before a comma, and two spans in one line.
4. **Ruler.**
   - `score.mjs` runs the detector, calls the respelling prompt from phase 2 through a small fetch, and applies the guards.
   - Gate before phase 2 wiring: run it twice, with the translation given to the prompt and without it.
     - If "without" keeps ≥ 9 right / ≤ 1 wrong, the call runs in parallel with the translation (no added latency).
     - Otherwise it runs after the translation, and the plan records the measured added latency.
   - The README says how to dump turns read-only from prod (`ConversationTurn` join `Conversation`, `'vi' = any(sourceLanguages)`) into `data/`, which is gitignored.

## Verification

- `pnpm --filter @chatofy/ai-providers test vietnamese-syllable`
- `pnpm --filter @chatofy/api test loanword-respelling`
- `node benchmarks/loanword-respelling/score.mjs data/vi-turns.json` meets the plan's ruler criterion. Record both arms (with and without the translation) in the phase notes.

## Risks

- **Over-flagging:** real Vietnamese written in a non-standard way, for example "hecta" (a loan already spelled as Vietnamese). The guards keep it, because no attested different-letter proposal exists. The ruler row asserts it.
- **Under-flagging:** errors that form valid syllables ("quốc cơ" for "poker"). This is out of scope, as the contract records.

## Outcome (2026-10-07)

- **Location change.** The guards live in `packages/ai-providers/src/text/loanword-respelling.ts`, not `apps/api`, so the ruler and the prompt-injection arm run the shipped code.
- **API change.** `acceptRespellings` returns a map keyed by the lowercased span, and `applyRespellings` finds the spans again on the line it is given.
- **Similarity.** The similarity measure is 2·LCS/(len a + len b). The floor stays at 0.5; the lowest right proposal, ammon→Altman, scores 0.545.
- **Ruler.** `benchmarks/loanword-respelling/score.mjs --repeats 3` gave 9 right, 1 wrong, 1 kept and 1 missed in each of 3 runs.
- **Gate.** The arm without the translation scored 7 right, so the call runs AFTER the translation.
