---
title: 'Phase 1: UI primitives and settings store'
status: todo
priority: P1
effort: '3h'
dependencies: []
---

# Phase 1: UI primitives and settings store

## Overview

Two new `packages/ui` primitives (`Switch`, `Slider`) and the web settings store
that every later phase reads. No visible change to `/translate` yet.

## Requirements

- Functional: a typed settings object with defaults, persisted to localStorage,
  surviving reload; unknown/corrupt stored values fall back rather than throw.
- Non-functional: no hydration mismatch; `Switch`/`Slider` match the kit's
  existing token vocabulary and focus-ring rule; dragging the volume slider must
  not write storage or re-render the transcript on every pointer tick.

## Architecture

`radix-ui` is already the kit's primitive source (`packages/ui/package.json:59`),
so both components are thin skins in the shape of `checkbox.tsx` — Root +
Indicator/Thumb, `data-slot` attributes, `cn()` over token classes.

Settings state is one object behind one hook. The extension's
`apps/extension/src/settings.ts` is the pattern to copy: merge stored partial over
`DEFAULT_SETTINGS`, then defensively whitelist each field on read so a value
written by an older build cannot pin the page into a state its UI can no longer
leave.

Shape (fields land across phases; declare them all now so the schema is written once):

```ts
interface TranslateSettings {
  direction: TranslationDirection; // moved off page.tsx useState
  voiceGender: VoiceGender;
  voiceOutput: boolean; // phase 4
  speed: number; // phase 4
  /**
   * Phase 5. Keyed by OUTPUT LANGUAGE, not flat.
   * Kokoro addresses voices by int sid, VieNeu by preset name — disjoint
   * vocabularies. A flat `voice` survives a direction flip and sends an English
   * sid to the Vietnamese engine.
   */
  voice?: { en?: string; vi?: string };
  volume: number; // 0..1
  transcriptLayout: 'stacked' | 'columns';
}
```

Persist with zod parse-on-read (`packages/types` already exports the direction and
gender schemas — reuse, do not restate).

**Whitelist rules — each exists because a specific failure was traced:**

| Field              | Rule                                                             | Why                                                                                                          |
| ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `volume`           | clamp to `[0, 1]`                                                | gain above 1 clips                                                                                           |
| `speed`            | clamp to `[0.5, 2]`, then **snap to the nearest phase-4 preset** | an in-range off-preset value (0.9, hand-edited) renders phase 4's `SegmentedControl` with no option selected |
| `voice.*`          | `z.string().max(64)`                                             | must match the wire bound exactly, or a longer value passes here and is refused downstream                   |
| `transcriptLayout` | whitelist, else `'stacked'`                                      | unknown value must not blank the transcript                                                                  |

**The voice token is NOT reconciled here.** The catalog is fetched over HTTP in
phase 5; a synchronous loader cannot validate a token against a catalog it has not
retrieved. Reconciliation belongs at the point of use (phase 5), and this loader
only bounds the string.

**Hydration:** read localStorage in an effect (or a mounted gate), never in a
`useState` initializer — the app router renders this on the server first. No
inline `<script>` is needed because none of these settings affect first paint,
unlike the theme (`apps/web/app/layout.tsx:63`).

**Write path must be split.** Radix `Slider` fires `onValueChange` on every pointer
move. `set(patch)` updates React state immediately but persists **debounced** (or on
`onValueCommit`); a synchronous `JSON.stringify` + `localStorage.setItem` per frame
runs on the same main thread as `PcmPlaybackQueue`'s chunk scheduling. Phase 2 sends
the gain value straight to the `GainNode`, not through a page-level state round trip.

## Related Code Files

- Create: `packages/ui/src/react/switch.tsx`
- Create: `packages/ui/src/react/slider.tsx`
- Create: `apps/web/src/lib/translate-settings.ts` (schema, defaults, load/save)
- Create: `apps/web/src/hooks/use-translate-settings.ts`
- Create: `apps/web/src/lib/translate-settings.spec.ts`
- Modify: `packages/ui/src/react/index.ts` (export the two primitives)

## Implementation Steps

1. Add `Switch` skin — `Switch.Root` + `Switch.Thumb` from `radix-ui`, modelled on
   `checkbox.tsx`: `border-border-control`, `shadow-elev-sm`,
   `focus-visible:ring-[3px] focus-visible:ring-ring/50`,
   `disabled:cursor-not-allowed`, `data-[state=checked]:bg-primary`. Thumb
   transition must carry `motion-reduce:transition-none`.
2. Add `Slider` skin — `Slider.Root/Track/Range/Thumb`. Same focus ring width (3px);
   track `bg-muted`, range `bg-primary`. Keep it keyboard-operable (Radix handles
   arrows); do not override `aria-*`. Expose `onValueCommit` to callers.
3. ~~Express any disabled state with a token pair rather than `opacity-50`.~~
   **Adjudicated during implementation — the control may dim.** WCAG 1.4.3 exempts
   disabled controls from contrast minimums, and `checkbox.tsx:14` / `toggle.tsx`
   already ship `disabled:opacity-50` with `skin-guard.spec.ts` passing over them;
   two outlier primitives would be the defect. What the finding actually binds is
   phase 4's caption — text explaining _why_ a control is disabled is not disabled
   content, must be full opacity on a measured token pair, and must never sit inside
   an `opacity-50` wrapper. See the finding-16 adjudication in `plan.md`.
4. Export both from `packages/ui/src/react/index.ts` under the shadcn-primitives
   block, alphabetically beside `Select`/`Separator`.
5. Write `translate-settings.ts`: `DEFAULT_TRANSLATE_SETTINGS`, a zod schema, and
   `loadTranslateSettings()` / `saveTranslateSettings()` against key
   `chatofy.translate-settings`. Loading merges over defaults and applies the
   whitelist table above. Wrap both in try/catch — a private window can throw on access.
6. Write `use-translate-settings.ts`: holds state, loads after mount, exposes
   `settings` plus `set(patch)` (immediate state, debounced persist). Return a
   `ready` flag so the panel can avoid rendering a default-valued control for one frame.
7. Spec the store: defaults when storage is empty; a stored partial merges; an
   out-of-range `volume`/`speed` clamps; **an in-range off-preset `speed` snaps**; a
   garbage JSON blob yields defaults; an unknown `transcriptLayout` falls back to
   `stacked`; a `voice.en` longer than 64 chars is dropped.

## Success Criteria

- [x] `Switch` and `Slider` render, are keyboard-operable, and carry the kit's 3px focus ring
- [x] Both exported from `@chatofy/ui/react`
- [x] Settings round-trip through localStorage
- [x] Corrupt/partial/out-of-range/off-preset stored values fall back, clamp or snap — covered by spec
- [x] Persist is debounced; a slider drag does not write storage per frame
- [x] No hydration warning in the browser console on `/translate`
- [x] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @chatofy/web test` green

## Risk Assessment

- **`radix-ui` may not re-export `Switch`/`Slider` under the names assumed.** Signal:
  import fails at build. Response: import from `@radix-ui/react-switch` /
  `@radix-ui/react-slider` directly and add the dep — same as any other skin.
- **`app-skin-guard.spec.ts` walks `apps/web/src` recursively with per-root floors
  (`:49-60`) and will police the new component classes.** Signal: that spec fails.
  Response: fix the class vocabulary, do not weaken the spec. Note this is the spec
  that can see components — `contrast-floors.spec.ts` cannot.
- **Declaring phase-4/5 fields now could rot if those phases change shape.** Signal:
  phase 4 needs a differently-shaped `speed`. Response: the schema is one file with
  one spec; adjust it there rather than threading a second settings object. Keep
  `voice` as an opaque bounded string — never an enum, at any layer.
