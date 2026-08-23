---
title: 'Phase 3: Button C1, and the Alert override it invalidates'
status: complete
priority: P1
effort: '0.75d'
dependencies: [2]
---

# Phase 3: Button C1, and the Alert override it invalidates

**This is the gate.** It is the only phase that removes an accessibility
correction, and the only one whose result cannot be judged from a component in
isolation — a borderless button has to be found by eye on a filled notice, which
is the ground it is weakest on.

## Overview

Give `Button` the C1 treatment: the quiet variant becomes an object sitting on
the surface — fill, drop shadow, no outline — that lifts on hover and presses on
active. Then deal with the `Alert` override that exists only to fix the border
being removed.

## Requirements

**Functional**

- The quiet button carries no `border-*` utility at rest.
- Hover lifts `-1px` to `--elevation-md`; active presses `+1px` back to
  `--elevation-sm`; both suppressed under reduced motion.
- The primary (accent-filled) button is unaffected in colour and keeps its
  contrast rows in `contrast-floors.spec.ts` untouched.
- Disabled removes the shadow and the transform, not just opacity.
- Control height is unchanged by this phase. It stays in the `size` variants.

**Non-functional**

- Motion durations from the token set. State change is `--duration-base` (200ms),
  which is where a hover lift belongs; colour stays at `--duration-fast`.
- `transform` and `box-shadow` only. Never `transition: all`, never geometry.

## Architecture

The C1 quiet button and the C1 field are deliberately opposite:

|        | Field                     | Quiet button                              |
| ------ | ------------------------- | ----------------------------------------- |
| Shadow | `inset` — cut in          | `--elevation-sm` — sits on                |
| Hover  | fill deepens, no movement | lifts `-1px`, `--elevation-md`            |
| Active | nothing                   | presses `+1px`                            |
| Edge   | inset hairline layer      | `inset 0 0 0 1px var(--surface-hairline)` |

The button's hairline edge is drawn as an **inset shadow layer** rather than a
`border`, so it composes into the same `box-shadow` declaration as the elevation
and cannot fight it for the box model. **Height does not move to the base.** `Button`'s height comes from its `size`
variant — `default: h-10`, `sm: h-9`, `lg: h-11`, `icon: size-10` — and
`direction-toggle.tsx:61` overrides even that with `size-auto`. A base `h-10` and a
variant `h-9` are single-class utilities of equal specificity, so which one wins is
decided by generated-stylesheet source order: the same "source-order accident" this
repo already refuses to build on (`layout.tsx:13-17`). Only `border: 0` and
`border-radius` go on the base — they are variant-independent.

The reason to state this at all: the review mockup broke exactly here, when
`height`, `border-radius` and `border:0` were factored into a class only `<input>`
carried and every button fell back to the user agent's square default border. The
lesson is that `border`/`radius` must reach every button — not that height should
join them.

**What happens to the `outline` variant.** It is not renamed and not deleted. Its
declaration changes from a transparent box with a control border to the treatment
above. The name survives because the shadcn CLI regenerates a variant of that name,
and a project-specific name would be re-broken by the next `shadcn add`. The doc
comment must say plainly that "outline" here no longer means an outline.

**The Alert override stays exactly as it is.** `alert.tsx` re-borders a notice's
actions in the notice's own hue, and `skin-guard.spec.ts:107-115` holds it. C1 does
not touch it: **a control inside a filled notice keeps its hue border.**

This is a recorded per-surface exception, decided deliberately. The alternative
considered was moving the hue from the border to the fill, and it was rejected on
measurement: the notice's label ink on a hue fill measures **1.90:1** (dark
`text` on `warning`), **2.58:1** (light), and **2.88:1** on `live` in both themes.
The primary consumer is `settings-pane.tsx:114` — the button that opens the user's
microphone. That is not the at-rest-boundary trade-off C1 accepted; it is the label
itself, and it would have failed 1.4.3's 4.5:1 outright. No `onWarning` ink token
exists to fix it, and minting one is a palette change this plan forbids.

Two consequences worth stating, because they make this phase smaller than it looks:

- `skin-guard.spec.ts:107-115` and its comment are **unchanged**.
- `contrast-floors.spec.ts:85` (`['live','liveSubtle',3.0,'action outline inside an
error notice']`) still measures a treatment that still renders. It does not
  become stale, so phase 5 does not rewrite it.

The existing override selector `[&_[data-slot=button]]:border-*` is an unscoped
descendant match, so it also reaches `default` and `live` buttons. It is inert on
those today because they carry no border width, and C1 does not change that. Left
as-is: narrowing it is a real improvement but a separate decision from this plan.

## Related Code Files

- Modify: `packages/ui/src/react/button.tsx` — the `outline` variant
- Modify: `packages/ui/src/react/alert.tsx` — action treatment, hue via fill
- Modify: `packages/ui/src/react/skin-guard.spec.ts` — rewrite the assertion at
  lines 107-115 and its explanatory comment
- Modify: `packages/ui/src/react/toggle.tsx` — its `outline` already carries
  `shadow-elev-sm`; align its hover so the two agree
- Review only: `packages/ui/src/react/select.tsx` — trigger shares the old
  language; phase 4 decides. It is in scope, not a non-goal.

## Implementation Steps

1. Rewrite the `outline` variant: fill `--secondary`, `--elevation-sm`, inset
   hairline layer, no `border-*`. Put `border: 0` and `border-radius` on the base so
   nothing falls through to the UA default. Leave `height` in the `size` variants.
2. Add `transform` to the transition property list — it is not there today
   (`button.tsx:42` lists `color,background-color,box-shadow`), so without this the
   lift is an instant jump for everyone.
3. Suppress the transform under reduced motion with a **transform-specific** escape:
   `motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0`.
   `motion-reduce:transition-none` — already present at `button.tsx:43` — removes
   the easing, not the movement, so a reader who asked for stillness would get a
   harder 1px snap than before. The existing guard cannot catch this: its check is
   `/\b(transition|animate)-/ && !/motion-reduce:/`, i.e. substring presence, and
   `button.tsx` already satisfies it.
4. Disabled: drop shadow and transform, keep `opacity-45` and
   `disabled:border-transparent` — the latter is now redundant but harmless, and
   removing it is a separate decision from this phase.
5. Leave `alert.tsx` and `skin-guard.spec.ts:107-115` alone. Add a sentence to
   `alert.tsx`'s variant comment recording that the hue border is now a deliberate
   exception to C1, not a leftover.
6. Align `toggle.tsx`'s hover with the button's.

## Success Criteria

- [x] No `border-*` utility on the quiet button at rest, verified by grep.
- [x] Button and field, rendered adjacent, read as opposite depths, are both 40px,
      and only the button moves on `:active`.
- [x] A quiet action on a `warning` and on a `live` Alert keeps its hue border and
      still measures at its existing floor. This surface is the recorded exception
      to C1, so here a ratio _does_ report success.
- [x] Reduced motion: no transform on hover or active; colour still responds.
      Verified by forcing the media feature, not by trusting the guard.
- [x] `skin-guard.spec.ts` green. **Modified, deliberately** — see the note in
      `alert.tsx`: C1 removing the button's border width made the Alert's hue
      override render nothing while the original assertion went on passing, so a
      width assertion was ADDED beside it. Nothing was rewritten or relaxed.
- [x] `contrast-floors.spec.ts` still green and untouched by this phase; its rows
      are rewritten in phase 5, deliberately not here.
- [x] Every existing consumer of `variant="outline"` still compiles unchanged.

## Risk Assessment

**The notice exception gets "tidied up" later.** The hue border on Alert actions
now looks inconsistent with every other button, which is exactly what makes it a
target for a future cleanup. _Signal:_ a PR removing `[&_[data-slot=button]]:border-*`
"for consistency". _Response:_ the comment added in step 5 and the retained
`skin-guard` assertion are the defence. Both must say _why_, with the measured
numbers, not merely _what_.

**The UA default border returns.** Already happened once in review, from factoring
`border`/`radius`/`height` into a class the element did not carry. _Signal:_ square
corners, hard dark edge. _Response:_ those three properties live on the base
`.btn` declaration, never only on a shared helper. Cheap to check, expensive to
miss.

**`shadow-elev-sm` is nearly invisible in dark.** Dark's `--elevation-sm` is a
single `rgba(0,0,0,0.35)` layer against `#111214`; the palette carries dark depth
through luminance steps instead. _Signal:_ the quiet button reads flat in dark
while correct in light. _Response:_ dark leans on the fill step
(`secondary` over `background`) plus the inset hairline, which is the mechanism
`globals.css:211-215` already documents. Verify in dark explicitly; do not assume
the light result transfers.
