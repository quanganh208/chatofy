---
phase: 7
title: 'Web plumbing — settings field, client, hook, i18n'
status: complete
priority: P2
effort: '5h'
dependencies: [4, 6]
---

# Phase 7: Web plumbing — settings field, client, hook, i18n

## Goal

Give the web app one stored selection, three typed API calls, one hook that
resolves a selection into hints, and every string both locales need — all before
a single component is written.

## Files to Create / Modify

- Modify: `apps/web/src/lib/translate-settings.ts`
- Modify: `apps/web/src/lib/translate-settings.spec.ts`
- Modify: `apps/web/src/clients/api-client.ts`
- Create: `apps/web/src/hooks/use-translation-contexts.ts`
- Create: `apps/web/src/hooks/use-translation-contexts.spec.tsx`
- Modify: `packages/i18n/src/en.ts`
- Modify: `packages/i18n/src/vi.ts`

## Tasks & Steps

1. `translate-settings.ts` gains exactly **one** field — a selection, not
   content:

   ```ts
   /**
    * Which saved AI Context a new conversation starts with, by its
    * client-minted id, or null for none.
    *
    * The ID, never the content. The context itself lives on the server, because
    * a glossary is authored work rather than a toggle and because the extension
    * cannot read this store at all (apps/extension/src/settings.ts:7-11).
    * Bounded here and never validated against the list — which contexts exist is
    * fetched over HTTP and is not knowable to a synchronous read, exactly as the
    * voice token records above.
    */
   contextId: string | null;
   ```

   with `contextId: null` in `DEFAULT_TRANSLATE_SETTINGS` (`:187-209`),
   `contextId: z.string().max(64).nullable().catch(null)` in
   `storedSettingsSchema` (`:326-347`), and the field copied through in
   `loadTranslateSettings` (`:368-381`).

   **No `migrate` step and no `SETTINGS_VERSION` bump.** The file already records
   the rule at `:279-281`: "An absent field reads as its default, which is the
   whole reason `loadTranslateSettings` merges over
   `DEFAULT_TRANSLATE_SETTINGS` before parsing."

2. Extend `translate-settings.spec.ts`: `a stored contextId survives the
round-trip`, `an over-long contextId reads as null`, `a v3 store with no
contextId reads as null and keeps every other field`.
3. `apps/web/src/clients/api-client.ts` gains three functions beside the existing
   ones, each going through `authedFetch` (`:73-...`) so they inherit the single
   401 recovery:
   - `listTranslationContexts()` → `translationContextListResponseSchema`
   - `saveTranslationContext(contextId, body)` → `translationContextSchema`
   - `deleteTranslationContext(contextId)` → 204
4. `use-translation-contexts.ts` — list, save, delete, plus the resolver:

   ```ts
   /**
    * The stored selection, resolved against the fetched list.
    *
    * Returns `null` for an id that no longer resolves, never an error. The rule
    * is `loadTranslateSettings`'s own, for the voice token: bound it in storage,
    * reconcile it "at the point of use, where the catalog has resolved". A
    * deleted context must read as "no context", and the panel must still render.
    */
   export function resolveContext(
     contexts: TranslationContext[],
     contextId: string | null,
   ): TranslationContext | null;

   /**
    * A stored context as the wire's hints.
    *
    * `undefined`, never `{}`, when nothing is selected: a request with no hints
    * produces a prompt byte-identical to the one without this feature
    * (translation-provider.ts:19-26), which is what lets the recorded injection
    * baseline keep describing the default path. An empty glossary array is
    * omitted for the same reason.
    */
   export function toHints(context: TranslationContext | null): TranslationHints | undefined;
   ```

   `toHints` maps `topic`/`hotwords`/`style` through, drops nulls and empty
   arrays, and passes `glossary` as the stored `{vi, en}` pairs untouched — the
   direction is resolved server-side, in the prompt builder, because only the
   session knows it.

5. `use-translation-contexts.spec.tsx`:
   - `the list loads and renders`
   - `a request failure leaves the list empty and reports it, without throwing`
   - `resolveContext returns null for an id not in the list` ← the stale-reference
     rule
   - `toHints returns undefined for no selection`
   - `toHints omits an empty glossary rather than sending []`
   - `toHints carries vi/en pairs through unchanged`
   - `save refetches the list`

   _(Deviation from the contract's acceptance criterion 11, stated rather than
   silent: the reconciliation is asserted here, not in
   `use-translate-settings.spec.tsx`. `useTranslateSettings` only reads
   localStorage and has no list to reconcile against — the resolver is what
   reconciles, so that is where the assertion belongs. The rendering half is
   asserted on the picker in phase 9.)_

6. Add every key to `en.ts` **and** `vi.ts`. All of them land here, before the
   components that read them, because parity is compiler-enforced
   (`vi.ts:42` is `export const vi: Messages`, `en.ts:525-529`) and a UI phase
   that adds a key to one file breaks the build for the other.
   - `web.preferences.aiContext`, `.aiContextHint`
   - `web.preferences.aiContext.empty`, `.new`, `.edit`, `.delete`, `.save`,
     `.cancel`, `.saving`
   - `web.preferences.aiContext.name`, `.description`, `.descriptionHint`
   - `web.preferences.aiContext.keywords`, `.keywordsHint`
   - `web.preferences.aiContext.glossary`, `.glossaryHint`, `.glossaryVi`,
     `.glossaryEn`, `.glossaryAdd`, `.glossaryRemove`
   - `web.preferences.aiContext.register`
   - `web.preferences.aiContext.limitReached`, `.saveFailed`, `.loadFailed`
   - `web.translate.context`, `web.translate.contextNone`,
     `web.translate.contextLocked`
   - `web.translate.registerNeutral`, `.registerFormal`, `.registerCasual`

   Vietnamese is reviewed against `vi.ts`'s own register rules (`:11-40`): the
   reader is "bạn", and the test is whether someone can restate the consequence
   from the Vietnamese alone.

## Verification

- `pnpm --filter @chatofy/i18n typecheck`
  → exits **0**. This is the parity proof: a key in `en.ts` missing from `vi.ts`
  is a compile error, not a runtime gap.
- `pnpm --filter web test translate-settings use-translation-contexts`
  → prints both files with **at least 10 passed**, 0 failed.
- `pnpm --filter web typecheck && pnpm --filter web lint` → both exit 0.
- `pnpm --filter web test` → the whole web suite still green (the accent spec is
  untouched and must not have moved).
