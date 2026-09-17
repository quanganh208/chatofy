---
phase: 4
title: 'HTTP contract — translation-contexts.ts'
status: complete
priority: P2
effort: '2h'
dependencies: [1]
---

# Phase 4: HTTP contract — translation-contexts.ts

## Goal

Declare the stored-context request and response schemas, reusing the socket's
glossary entry rather than restating it, so a value that can be stored can
always be sent.

## Files to Create / Modify

- Create: `packages/types/src/http/translation-contexts.ts`
- Create: `packages/types/src/http/translation-contexts.spec.ts`
- Modify: `packages/types/src/http/index.ts`

## Tasks & Steps

1. Create `translation-contexts.ts`, importing from the events barrel:

   ```ts
   import { glossaryEntrySchema, translationHintsSchema } from '../events/ws-events.js';
   ```

   with a header recording why: the socket schema and the provider caps are
   deliberately independent — "this schema is what the socket will accept, that
   one is what the prompt will carry, and neither trusts the other"
   (`ws-events.ts:26-30`) — because they guard two DIFFERENT trust boundaries.
   HTTP and WS guard the SAME one (a client), so a glossary that can be stored
   but not sent is a silent truncation the user cannot see.

2. Declare the ceilings and the two schemas, as the contract specifies:

   ```ts
   export const CONTEXT_LIMITS = {
     MAX_NAME_CHARS: 60,
     MAX_TOPIC_CHARS: 200,
     MAX_HOTWORDS: 48,
     MAX_HOTWORD_CHARS: 64,
     MAX_GLOSSARY: 24,
     MAX_GLOSSARY_TERM_CHARS: 64,
     /**
      * How many contexts one account may hold. A ceiling rather than none,
      * because this is the first authenticated route in the product whose write
      * creates an UNBOUNDED number of rows — `PUT /conversations/:id` replaces,
      * and `PUT /auth/me` updates one row.
      */
     MAX_CONTEXTS_PER_OWNER: 20,
   } as const;

   export const saveTranslationContextRequestSchema = z.object({
     name: z.string().min(1).max(CONTEXT_LIMITS.MAX_NAME_CHARS),
     topic: z.string().max(CONTEXT_LIMITS.MAX_TOPIC_CHARS).nullable().default(null),
     hotwords: z
       .array(z.string().min(1).max(CONTEXT_LIMITS.MAX_HOTWORD_CHARS))
       .max(CONTEXT_LIMITS.MAX_HOTWORDS)
       .default([]),
     glossary: z.array(glossaryEntrySchema).max(CONTEXT_LIMITS.MAX_GLOSSARY).default([]),
     style: translationHintsSchema.shape.style.unwrap().nullable().default(null),
   });

   export const translationContextSchema = saveTranslationContextRequestSchema.extend({
     /** The client-minted id, echoed. Never a server cuid — see the Prisma model. */
     id: z.uuid(),
     updatedAt: z.string(),
   });

   export const translationContextListResponseSchema = z.object({
     contexts: z.array(translationContextSchema),
   });
   ```

   No user id anywhere in a request body, for the reason `updateMeRequestSchema`
   records (`packages/types/src/http/auth.ts:270-277`): "the safest way to
   guarantee it is absent is to have no field for it."

3. Add the named re-exports to `packages/types/src/http/index.ts`, following the
   file's explicit-named-export convention (`:1-3`: no `export *`, so the root
   barrel can compose domain + http + events without collisions). Export
   `CONTEXT_LIMITS`, the three schemas, and the types
   `SaveTranslationContextRequest`, `TranslationContext`,
   `TranslationContextListResponse`.
   **Name check:** `TranslationContext` does not collide with anything in the
   domain or events barrels (grep before adding).
4. Create `translation-contexts.spec.ts` asserting, by name:
   - `a 61-character name is refused` / `a 60-character name is accepted`
   - `absent optional fields default to null and empty arrays`
   - `25 glossary pairs are refused, 24 accepted`
   - `an entry with an empty side is refused`
   - `the HTTP glossary entry is the socket's entry, not a restatement` —
     assert schema identity:
     `expect(saveTranslationContextRequestSchema.shape.glossary.element).toBe(glossaryEntrySchema)`.
     This is the whole point of the import and is the one thing a copied schema
     would silently break.
   - `style accepts neutral | formal | casual and null, and refuses anything else`

## Verification

- `pnpm --filter @chatofy/types test`
  → `translation-contexts.spec.ts` reports **7 passed**, 0 failed, and
  `ws-events.spec.ts` and `conversations.spec.ts` still pass. Zero failures.
- `pnpm --filter @chatofy/types build && pnpm --filter @chatofy/types typecheck`
  → both exit 0, and
  `grep -c 'CONTEXT_LIMITS' packages/types/dist/index.d.ts` prints ≥ 1.
