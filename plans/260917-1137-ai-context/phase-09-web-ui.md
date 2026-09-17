---
phase: 9
title: 'Web UI — editor on /preferences, picker on /translate'
status: complete
priority: P2
effort: '8h'
dependencies: [7, 8]
---

# Phase 9: Web UI — editor on /preferences, picker on /translate

## Goal

Author contexts in the screen's second and last elevated surface, pick one on
`/translate` without spending an accent, and send its hints on
`client.session.start`.

## Files to Create / Modify

- Create: `apps/web/src/components/preferences/ai-context-section.tsx`
- Create: `apps/web/src/components/preferences/ai-context-section.spec.tsx`
- Create: `apps/web/src/components/translate/context-picker.tsx`
- Create: `apps/web/src/components/translate/context-picker.spec.tsx`
- Modify: `apps/web/src/components/preferences/conversation-defaults-section.tsx`
- Modify: `apps/web/app/(app)/preferences/page.tsx`
- Modify: `apps/web/src/components/translate/cascade-panel.tsx`
- Modify: `apps/web/src/components/translate/cascade-panel.spec.tsx`
- Modify: `apps/web/src/design/accent-budget-app.spec.tsx`
  - **An OPEN picker is an elevated surface — assert the trigger, never the open
    menu.** `packages/ui/src/react/select.tsx:104` puts `shadow-elev-lg` on
    `SelectContent`, and `apps/web/src/design/surface-count.ts:26` counts
    `shadow-elev-lg` as a surface. The counter queries `document.body`
    (`:20-24`) precisely so portalled content is visible to it, so a spec row
    that renders the picker in its open state counts one MORE surface than the
    same screen closed. Any new `/translate` row must therefore leave the Select
    closed, or budget the extra surface deliberately.
  - **Two places pin this screen, not one.** Besides the screen-table rows at
    `:625-651`, an independent test at `:855-870` mounts `PreferencesPage` and
    asserts `accentFilledControls(container).length` is `0`. So the closed
    state must spend zero accent — the "New context" button is
    `variant="outline"`, never filled — or that test fails even with the
    screen table updated. It also exists to prove the counter ignores a checked
    Switch's `data-[state=checked]:bg-primary` state variant, so it must keep
    passing for that reason too.

## Tasks & Steps

1. `ai-context-section.tsx` — the library and its editor, `<SettingsSection
panel>`, which makes it the screen's **second** elevated surface (the first is
   `ConversationDefaultsSection`, `conversation-defaults-section.tsx:33-35`).
   - **INLINE editor, never a `Dialog`.** `surface-count.ts:28-33` queries
     `document.body` precisely so portalled content is counted, so a dialog would
     be a THIRD surface and the gate would fail. The editor expands in place
     under the list.
   - The list: name + a one-line summary per row, with `Edit` (outline) and
     `Delete` (ghost).
   - The editor: `Input` for name, the new `Textarea` for description,
     a keyword list, a repeating two-column `Input` pair for `vi` / `en` with
     add/remove, and a `SegmentedControl` for register.
   - `Save` is the screen's **one** accent-filled control, and it exists only
     while the editor is open. Closed, the screen spends zero accent, which is a
     normal answer.
   - The "New context" button is disabled with `limitReached` once the caller
     holds `CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER`; the words explain the
     refusal, which is the rule `settings-row.tsx:19-27` records.
2. `conversation-defaults-section.tsx` gains one `SettingsSectionRow` holding the
   `ContextPicker`, beside direction and voice. `running={false}` there, as
   everything else on that page is. It already holds the page's single
   `useTranslateSettings` call site (`:28-32`), so the selection is read and
   written there and nowhere else on `/preferences`.
3. `preferences/page.tsx` renders `<AiContextSection />` between
   `InterfacePreferencesSection` and `ConversationDefaultsSection`, and its
   docblock (`:16-28`) is updated: two sections become three, one surface becomes
   two, and the reason the second one is earned — a library of named authored
   objects is a thing you work on as a unit.
4. `context-picker.tsx` — a `Select` over the fetched list plus a "None" option,
   `disabled` while running with `web.translate.contextLocked` as its hint (the
   same rule every other `session.start` setting follows,
   `voice-settings-panel.tsx:31-35`). **Renders nothing when the list is empty**,
   mirroring `VoicePicker`'s render-nothing case — which is what keeps every
   existing row of the accent spec unchanged, since the default mock answers with
   no contexts.
5. `cascade-panel.tsx`:
   - mount `<ContextPicker>` in the existing settings dock row beside
     `DisplaySettingsPopover` (`:528-530`);
   - add one line inside the existing `conversation.start({...})` (`:495-522`):
     ```ts
     // `undefined`, not an empty object, when no context is selected — a request
     // with no hints produces a prompt byte-identical to the one without this
     // feature (translation-provider.ts:19-26), which is what lets the recorded
     // injection baseline keep describing the default path.
     hints: toHints(resolveContext(contexts, settings.contextId)),
     ```
   - call `useTranslationContexts()` here, which is the page-level component for
     `/translate`.
6. `cascade-panel.spec.tsx`: `a selected context reaches session.start as hints`,
   `no selection sends no hints key at all`, `a contextId that no longer resolves
sends no hints`.
7. `accent-budget-app.spec.tsx` — **all four edits in this one change**, because
   the table is enforced in both directions with `KNOWN_VIOLATIONS` empty
   (`:744`):
   - add `listTranslationContexts` to the `@/clients/api-client` mock
     (`:75-83`), defaulting to `{ contexts: [] }`, with `saveTranslationContext`
     and `deleteTranslationContext` as bare `vi.fn()`s;
   - flip both existing `/preferences` rows (`:625-651`) from `surfaces: 1` to
     `surfaces: 2`;
   - add `/preferences — editing a context`: three stored contexts,
     `press` the New/Edit button, `shows` the textarea,
     `filled: 1, surfaces: 2`;
   - add `/translate — a context selected`: three stored contexts and a
     `contextId` in storage, `shows: '[data-slot="select-trigger"]'`,
     `filled: 1, surfaces: 0` — the picker is a `Select` and Start remains the
     screen's one accent.

   `press`/`shows` rather than `open`: the `open` helper asserts a
   `[data-slot="popover-content"]` appeared (`:824-828`), and an inline editor
   portals nothing.

8. `KNOWN_VIOLATIONS` stays `{}`. If a row has to be added there, stop and fix
   the screen instead — the table is "a deliberate, temporary admission, not a
   place to park one" (`:736-744`).

## Verification

- `pnpm --filter web test`
  → the whole suite green, 0 failed. Specifically `the app accent budget` reports
  every row passing, including `/preferences — the catalog is empty draws 0
accent-filled controls`, `/preferences — editing a context draws 1
accent-filled control` and `/translate — a context selected draws 1
accent-filled control`; `every screen is valid HTML` reports no
  `cannot be a descendant`.
- `grep -c 'KNOWN_VIOLATIONS: Record<string, number> = {}' apps/web/src/design/accent-budget-app.spec.tsx`
  → prints `1`.
- `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build`
  → all exit 0.
