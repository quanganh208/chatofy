# Phase 1 — Contracts + summarization provider

**State: scaffolded on `feat/meeting-minutes-llm`.**

## Delivered

### Shared types (`@chatofy/types`)

- `src/domain/minutes.ts` — `minutesStatusSchema`, `actionItemSchema`,
  `meetingMinutesSchema` (+ inferred types). Exported from `domain/index.ts`.
- `src/http/minutes.ts` — `minutesSourceTurnSchema`,
  `generateMinutesRequestSchema`, `minutesResponseSchema`. Exported from
  `http/index.ts`.

### AI provider (`@chatofy/ai-providers`)

- `src/interfaces/summarization-provider.ts` — `SummarizationProvider`,
  `SummarizationRequest`, `MeetingMinutesDraft`, `ActionItemDraft`.
- `src/providers/gemini/minutes-prompt-builder.ts` — minutes instruction +
  `wrapMinutesTranscript` (reuses translator `wrapTranscript`) + reminder.
- `src/providers/gemini/gemini-summarization-provider.ts` — blocking JSON pass,
  reuses `KeyRotation` + `error-classification`; defensive JSON parse.
- `registry/provider-registry.ts` — `summarization` added to `ProviderKindMap`.
- Barrels updated (`interfaces/index.ts`, root `index.ts`).

## Remaining in this phase

- [ ] Unit-test the provider parse paths: valid object, non-JSON body, partial
      object (missing arrays → `[]`, missing summary → `''`), action items with
      null owner/dueDate. Mock the SDK exactly as `gemini-translation-provider.spec.ts` does.
- [ ] Unit-test `minutes-prompt-builder`: transcript is wrapped, injected
      `</transcript>` is neutralized, echoed tags are stripped. Prove request
      SHAPE only (behavior is the benchmark's job — phase 5).
- [ ] Confirm the model ladder (`gemini-3.5-flash` → `-lite`) against the live
      API for cost/latency; adjust `DEFAULT_MODELS` with the measured numbers in
      a comment, as the translation provider documents its own.

## Verify

`pnpm turbo run typecheck --filter=@chatofy/types --filter=@chatofy/ai-providers`
→ green. Then the two spec files above pass.
