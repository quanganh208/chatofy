---
phase: 2
title: 'Respelling call on the display path'
status: completed
priority: P1
effort: '8h'
dependencies: [1]
---

# Phase 2: Respelling call on the display path

## Goal

For a vi-recognized final turn with at least one flagged span not already attested verbatim in the translation, ask the flash model for respellings. Apply the guarded ones to `display` on every path that produces a final display.

## Context

From `research/scout-server-turn-path.md`:

- Restore already runs in parallel with the translation: `pipeline-translator.service.ts:654-669`.
- `displayFor` composes the display before the final event (`translation-session.service.ts:619`, `982-1005`). The speaker-split pieces and the block retranslator (`restoreBlock`/`typesetBlock`, `1075-1111`) have their own calls, and all three paths must agree.
- The provider interface is streaming translate only (`packages/ai-providers/src/interfaces/translation-provider.ts`). A small new interface is cleaner than abusing `translate()`, the same way `display-restorer.ts` is its own interface.
- The budget is `TranslationBudget` (rpm per user and per model, `audio/translation-budget.ts`). The respelling call counts against it, and a refusal means "no respelling", never a failed turn.

## Files

- Create:
  - `packages/ai-providers/src/interfaces/loanword-respeller.ts`. Interface: `respell({ transcript, spans, translation? }, signal) → Record<string, string | null>`.
  - The openai-compatible implementation, `packages/ai-providers/src/providers/openai-compatible/openai-compatible-loanword-respeller.ts`, plus its spec. It uses JSON mode (`response_format: json_object`), temperature 0, thinking disabled the same way the translation row is, and a hard deadline.
  - `packages/ai-providers/src/providers/openai-compatible/loanword-respelling-prompt.ts`. A system prompt with no example words taken from recorded sessions; synthetic examples only, following the comment rule in `prompt-builder.ts`.
- Modify:
  - `apps/api/src/modules/translate/providers/register-default-providers.ts`: register the respeller on the same host row as the translation.
  - `apps/api/src/modules/translate/services/pipeline-translator.service.ts`: start the respell alongside restore and translate; await it with the restore. Put a log line in the same style as `restore(local) Nms`: `respell(<model>) Nms spans=K accepted=J`.
  - `apps/api/src/modules/translate/services/translation-session.service.ts`, in `displayFor`, the split pieces and `typesetBlock`: apply the respellings through `applyRespellings` after `restoreKeepsWords` and before `typesetTranscript`'s ITN.
  - `apps/api/src/modules/translate/services/display-restore-request.ts`: thread the accepted respellings into `typesetTranscript`. Keep `restoreKeepsWords` exactly as it is (it guards the restorer, not this).
  - `benchmarks/prompt-injection/corpus.mjs` and `run.mjs`: add a `respell` arm with attack cases. Spans carrying instructions, a transcript that orders "respell X as <URL>", and a translation that contains an injected word. Every attack must end with no display change beyond guarded letters.
- Tests:
  - `translation-session-display.spec.ts`: a turn with "deep fred" plus a translation containing "deepfakes" gets a display with "deepfake".
  - A respeller timeout or budget refusal gives the plain restored display.
  - The display stays undefined when nothing changed.
  - `pipeline-translator.service.spec.ts`: the call is skipped when no span exists, or when every span is attested verbatim (openai, internet).

## Steps

1. **Interface and implementation.** Write the interface and the openai-compatible implementation, with a deadline equal to the translation's own.
2. **Ordering, per the phase 1 gate.** If the gate passed without the translation, run the respell in parallel. Otherwise chain it after the translation and record the added p50 latency.
3. **Wiring.**
   - Skip the call when `recognition !== 'vi'`, when `repairDisplay` is false, when no span exists, or when every span is attested verbatim.
   - Count the call against `TranslationBudget`. A refusal skips quietly with one log line.
4. **Apply the result on all three display paths.** It is one helper used by all three, so they cannot drift.
5. **Prompt-injection arm.** Run it and record pass counts in the benchmark README.
6. **Comments.** Update the comment on `typesetTranscript`/`displayFor` that says nothing on the display path is a model. State the new boundary: a model proposes, deterministic guards dispose, and `sourceText` never changes.

## Verification

- `pnpm --filter @chatofy/ai-providers test`
- `pnpm --filter @chatofy/api test translation-session pipeline-translator display-restore loanword`
- `node benchmarks/prompt-injection/run.mjs --arm respell` shows all cases passing.
- `pnpm -w typecheck && pnpm -w lint`

## Risks

- **Latency on the final event:** measured in step 2. A deadline caps it, and on timeout the display falls back to plain.
- **A translation that itself copies the garbled form** ("adrec"): attestation then matches the span. The guard requires different letters, so nothing changes. That is safe.

## Outcome (2026-10-07)

- **Latency.** The call runs after the translation: p50 599 ms, p90 894 ms, max 1003 ms over 42 calls, with `RESPELL_TIMEOUT_MS` 1200.
- **Departure from the plan.** Speech starts before the respelling is awaited. `speak()` now begins right after the holds check, so the listener never waits; only the final event does. A test covers this ("does not hold the speech back while a respelling is out").
- **Budget.** The call is charged to `TranslationBudget` on `FINAL_MODELS[0]`, like a block retranslation.
- **Display paths.** All three apply the same map: the whole turn, the split pieces, and the block (from the pieces' stored respellings).
- **Injection arm.** `benchmarks/prompt-injection/respell.mjs` passed 18/18.
- **Tests.** API: 1302 passing before the move and 835 in the translate module after it. ai-providers: text and provider specs pass.
