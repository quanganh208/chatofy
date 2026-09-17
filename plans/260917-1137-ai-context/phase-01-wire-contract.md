---
phase: 1
title: 'Wire contract — glossary keyed {vi, en}'
status: complete
priority: P2
effort: '3h'
dependencies: []
---

# Phase 1: Wire contract — glossary keyed {vi, en}

## Goal

Add one field, `glossary`, to `translationHintsSchema` and its provider mirror,
with entries keyed by LANGUAGE rather than by role, so one stored dictionary
serves both directions of a bidirectional meeting.

## Files to Create / Modify

- Modify: `packages/types/src/events/ws-events.ts`
- Create: `packages/types/src/events/ws-events.spec.ts`
- Modify: `packages/types/src/events/index.ts`
- Modify: `packages/ai-providers/src/interfaces/translation-provider.ts`
- Modify: `packages/ai-providers/src/index.ts`

## Tasks & Steps

1. In `ws-events.ts`, above `translationHintsSchema` (currently `:36-44`), add:

   ```ts
   /**
    * One dictionary entry: a term in each language.
    *
    * Keyed BY LANGUAGE, not by role, and that is the load-bearing choice. The
    * extension translates one meeting in BOTH directions at once from ONE
    * settings object — `meeting-capture.ts:341` starts a session on
    * `settings.direction` and `:455` starts another on
    * `reverseDirection(settings.direction)` — so a `{source, target}` pair would
    * be applied backwards in one of them, with nothing on screen to say so.
    *
    * Both sides bounded at the hotword ceiling, because an entry IS two hotwords
    * by cost. `min(1)` on each: a pair with an empty side names a rendering of
    * nothing, or nothing as a rendering, and neither is a thing the prompt can
    * say.
    */
   export const glossaryEntrySchema = z.object({
     vi: z.string().min(1).max(64),
     en: z.string().min(1).max(64),
   });
   export type GlossaryEntry = z.infer<typeof glossaryEntrySchema>;
   ```

2. Add `glossary` to `translationHintsSchema`, between `hotwords` and `style`,
   with a docblock recording: 24 rather than 48 because an entry carries two
   terms plus a separator; and that it is paid up to FIVE times per turn —
   `MAX_SPECULATIONS_PER_TURN = 4`
   (`apps/api/src/modules/translate/session/translation-model-policy.ts:17`)
   plus the final pass (`translation-session.service.ts:266-272, 338-341`) —
   plus once more on the live preview (`session/live-preview.ts:235`).

   ```ts
   glossary: z.array(glossaryEntrySchema).max(24).optional(),
   ```

3. Export `glossaryEntrySchema` and the `GlossaryEntry` type from
   `packages/types/src/events/index.ts`, beside `translationHintsSchema` at
   `:11-25`. The root barrel (`packages/types/src/index.ts`) is
   `export * from './events/index.js'` and needs no edit.
4. Mirror it in `packages/ai-providers/src/interfaces/translation-provider.ts`
   as a plain interface beside `TranslationHints` (`:27-47`):

   ```ts
   export interface GlossaryEntry {
     vi: string;
     en: string;
   }
   ```

   and `glossary?: GlossaryEntry[]` on `TranslationHints`, with a docblock
   recording what the field must NOT be read as: a pair is a rendering the model
   may choose when it sees the term, not a substitution it performs, and not a
   licence to insert either side into a sentence that lacks it.

5. Add `GlossaryEntry` to the type re-export list in
   `packages/ai-providers/src/index.ts` (`:6-35`), beside `TranslationHints`.
6. Create `packages/types/src/events/ws-events.spec.ts` — none exists today
   (`packages/types/src/http/conversations.spec.ts` is the only spec in the
   package) — asserting, by name:
   - `accepts 24 pairs` / `rejects 25 pairs`
   - `accepts a 64-character side` / `rejects a 65-character side`
   - `rejects an entry whose vi is empty` / `rejects an entry whose en is empty`
   - `rejects an entry missing a side entirely`
   - `hints with no glossary still parse` (absent stays absent — zod omits an
     optional key rather than setting it undefined, which
     `translate.gateway.ts:266-269` depends on)
   - `sessionOptionsSchema carries the glossary through` — parse a full
     `client.session.start` payload and assert `parsed.hints.glossary` survives.

## Verification

- `pnpm --filter @chatofy/types test`
  → prints `ws-events.spec.ts` with **9 passed**, 0 failed, and the existing
  `conversations.spec.ts` still passing. Zero failures overall.
- `pnpm --filter @chatofy/types build && pnpm --filter @chatofy/ai-providers typecheck && pnpm --filter @chatofy/ai-providers build`
  → all three exit 0; `packages/ai-providers/dist/index.d.ts` contains
  `GlossaryEntry` (`grep -c 'GlossaryEntry' packages/ai-providers/dist/index.d.ts`
  prints a number ≥ 1).
