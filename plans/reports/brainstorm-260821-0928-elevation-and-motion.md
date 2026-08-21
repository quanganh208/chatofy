# Brainstorm — elevation and a motion scale

Date: 2026-08-21 · Branch: `feat/production-ui-ux` · Mode: `--advice`

## What was asked

User, after the production-UI branch landed: the style is still wrong. No smooth
animation on web or extension; dark borders on a white ground read dead flat.

## Diagnosis — not a bug

Both complaints are the accepted direction working as specified.

**Flatness is written into the guidelines.** `docs/design-guidelines.md`:
"this direction separates surfaces with rules instead of luminance steps".
`packages/ui/src/tokens.ts` exports `color`, `colorLight`, `palettes`, `overlay`,
`space`, `radius`, `fontSize`, `fontWeight` — **no elevation token exists**. The
`shadow-xs`/`shadow-sm` in `card.tsx:10`, `checkbox.tsx:14`, `radio-group.tsx:28`,
`select.tsx:32,57`, `segmented-control.tsx:88` are stock-shadcn leftovers, never
designed.

**Motion poverty likewise.** Guidelines: "Minimal, and never in the way of reading
a translation", four permitted motions. **No duration or easing token exists.**
Everything shipped is `transition-colors` (Tailwind default 150ms), two
`transition-[width] duration-75` meters, one `animate-ping`, one `animate-spin`.
Nothing is coordinated because there is no scale to coordinate against.

**The overlay contradicts the philosophy.** `overlay-styles.ts:81` carries
`box-shadow: 0 4px 14px rgba(0,0,0,.4)` and `:119` `0 8px 28px rgba(0,0,0,.45)` —
hardcoded, untokenised. The one surface with depth is the one outside the token
layer. Not a consistent philosophy; one side was forgotten.

Satisfying the user therefore means revising the accepted direction, not patching
call sites.

## Contract

**Outcome** — web, popup and overlay read as one product with physical depth:
surfaces layered by shadow rather than ruled apart by borders, every interaction
moving on one shared rhythm instead of Tailwind's default 150ms.

**Constraints**

- Palette and contrast floors unchanged (user decision).
  `plans/260820-1131-two-theme-palette/measure-palette.py` stays the authority —
  restored this session, baseline **54/54 pass**.
- **Elevation needs both halves, like every colour token.** A black drop shadow on
  `#111214` is near invisible; on dark, depth must come from a lighter surface plus
  a stronger shadow. The overlay escapes this only because it sits on arbitrary
  video, not on `bg`.
- **`token-parity.spec.ts` will block the obvious spelling.** `COLOUR_LIKE`
  (`:172`) is anchored at `^` and matches `light-dark(`. So
  `--shadow-md: light-dark(…,…)` fails `:247` "declares no colour the mapping does
  not account for". Writing `0 8px 24px light-dark(rgba…,rgba…)` slips past the
  anchor — **rejected as evading a guard**. Extend the spec to cover elevation.
- Overlay is a hand-written CSS string injected into a third-party page; no
  Tailwind. The byte constraint is about fonts and assets, not CSS lines —
  `overlay-styles.ts` is already 12,910 bytes, so a shadow line costs tens. It also
  already has a `prefers-reduced-motion` block at `:171`: extend it, do not invent
  a second mechanism.
- `skin-guard.spec.ts` bans stay — verified list: `dark:`, `bg-accent`,
  `text-accent-foreground`, `bg-popover`/`text-popover-foreground`, `border-input`,
  `text-sm`/`text-xs`, the `@/lib/utils` alias. It does **not** ban
  `hover:bg-primary/90`; that rule lives only in the guidelines table. Nothing there
  blocks shadows or motion.
- All motion behind `prefers-reduced-motion`. No motion library.

**Non-goals** — accent hue and palette unchanged; no new choreography, springs or
route transitions beyond the segmented-control thumb; `apps/mobile` untouched; the
overlay keeps its hand-written string; the 32 residual Tailwind size utilities not
swept; copy register unchanged; the voice-control duplication not consolidated.

**Acceptance criteria**

1. `tokens.ts` exports `elevation` (each step two halves) and `motion`
   (duration + easing).
2. All three surfaces read from it — `apps/web/app/globals.css`,
   `apps/extension/entrypoints/popup/theme.css`,
   `apps/extension/entrypoints/content/overlay-styles.ts` (hardcodes at `:81`,
   `:119` gone).
3. `token-parity.spec.ts` extended to cover elevation and motion, and **able to
   fail** when one half goes missing.
4. No stock-shadcn `shadow-xs`/`shadow-sm` left in `packages/ui`.
5. All 13 shared components run on token duration/easing; no bare
   `transition-colors`.
6. The two `motion-reduce:` gaps the guidelines already record are closed:
   `audio-source-controls.tsx:86`, `baseline/page.tsx:70`.
7. `design-guidelines.md` revised: the "rules instead of luminance" clause and the
   Motion section replaced; an Elevation table added.
8. `measure-palette.py` still passes 54/54.
9. Every component rendered by web and the popup is a shadcn primitive or composed
   only from shadcn primitives. `ThemeToggle`, `StatusIndicator`, `DirectionToggle`
   and `SegmentedControl` no longer hand-roll their structure.
10. `Tabs` and `ToggleGroup` generated by the CLI and re-skinned; `skin-guard.spec.ts`
    passes over both.
11. `segmented-control.spec.tsx` rewritten to assert the ToggleGroup contract — a
    `group` of toggles, focus-then-commit — rather than deleted. The guidelines
    paragraph arguing for RadioGroup rewritten to record the reversal.
12. The overlay still passes `overlay-invariants.spec.ts` — no `var(` in its sheet.

## How elevation lands on each theme

**Light gets shadows. Dark gets luminance steps it already owns.** A black drop
shadow on `#111214` is near invisible, so dark cannot be carried by shadow. It does
not need to be: `bg #111214 → surface #191B1E → surfaceRaised #212429` already exist
and are already measured. Dark elevation is those three steps finally being _used_
as elevation instead of leaning on hairlines.

Consequence, and it is the important one: **no new palette value is introduced**, so
the floors do not move and `measure-palette.py` stays 54/54. The user's "palette
unchanged" constraint survives the direction change intact.

## Decisions the user made

| Fork                 | Chosen                                         | Rejected                                      |
| -------------------- | ---------------------------------------------- | --------------------------------------------- |
| Depth mechanism      | real elevation — shadow scale, border demoted  | tinted/gradient grounds; both combined        |
| Motion ambition      | token scale + micro-interaction sweep          | entrance/exit choreography; expressive/spring |
| Scope                | web + popup + overlay                          | mobile                                        |
| Constraints released | "rules not luminance", "one accent per screen" | palette/hue untouched                         |
| Themes affected      | both — light and dark read flat                | light-only                                    |
| Approval gate        | mock accepted before any token is written      | straight to plan                              |

**"One accent per screen" is released but not needed.** The elevation direction
does not require breaking it. Left intact unless the user asks for extra colour
emphasis.

## Amendment — every DOM component becomes shadcn

User decision, stated three times and escalating: remove all non-shadcn UI.
Accepted. What follows is the boundary of what that sentence can mean, measured.

### What was already true

shadcn is not a direction to adopt here — it is standing policy. Nine of thirteen
exports in `packages/ui/src/react/index.ts` are CLI-generated and re-skinned:
`Alert`, `Badge`, `Button`, `Card`, `Checkbox`, `Label`, `RadioGroup`, `Select`,
`Separator`. `components.json` (style `new-york`) plus `skin-guard.spec.ts` are the
mechanism. The four hand-written ones exist because **shadcn ships no equivalent
shape**, not because anyone preferred hand-rolling.

### What converts

| Today                                  | Becomes                        | Note                                       |
| -------------------------------------- | ------------------------------ | ------------------------------------------ |
| `ThemeToggle` — 3 hand-written buttons | shadcn `ToggleGroup`, single   | clean fit                                  |
| `StatusIndicator` — dot + label        | shadcn `Badge` + the pulse dot | the dot stays; see below                   |
| `DirectionToggle`                      | shadcn `Button` + `Badge`      | already a swap button plus two named sides |
| `SegmentedControl` — Radix RadioGroup  | shadcn `ToggleGroup`           | **costs semantics — see below**            |

Plus `Tabs` and `ToggleGroup` generated from the CLI and re-skinned. `Tabs` ships
with no consumer, by decision; knip is **not in CI** (`ci.yml` runs lint, typecheck,
test, build, verify:build, extension e2e) and is **already red** — 5 unused exports
and 1 config hint on this branch, none in `packages/ui` — so consumer-less
primitives add lines to an already-failing local report and break no gate.

### What cannot convert, and the spec that says so

**The overlay.** `overlay-invariants.spec.ts:70` asserts
`expect(STYLE).not.toContain('var(')`. Every Tailwind utility emits a custom
property, and `all: initial` **does not reset custom properties** — they cross the
shadow boundary deliberately, as a public styling interface. A Tailwind-themed
overlay is therefore repaintable by the meeting page, **including the recording
indicator the page must not be able to touch**. This is a security invariant with a
test, not a preference. The overlay keeps its hand-written string.

**`apps/mobile`.** React Native, no DOM. `react/index.ts` records that mobile must
never resolve React, Radix, or any DOM type; the subpath split exists for this.

So "all shadcn" is delivered in full across **web and the popup** — every surface
the user actually sees as web and extension UI — with the overlay as the one
documented exception.

### The cost the user accepted

Swapping `SegmentedControl` onto `ToggleGroup` changes what the control _is_:
`role="radiogroup"` with `radio` children becomes a `group` of toggle buttons, and
arrow keys stop selecting as they move (Radix ToggleGroup moves focus and commits
on Enter/Space; RadioGroup selects on arrow). `segmented-control.spec.tsx` pins the
old behaviour across ~30 assertions — `:78` is literally
`it('is a radiogroup of radios, not a toolbar of buttons')` — and the component
header records that those were written _before_ the primitive swap precisely to
prevent this being done accidentally.

Done deliberately now, at the user's instruction. The spec is rewritten to assert
the new contract rather than deleted, and the guidelines paragraph that argued for
RadioGroup is rewritten to record the reversal and its reason.

**Not weakened:** `StatusIndicator`'s label and pulse. `status-indicator.tsx`'s
header defends them — `live` is red and `speaking` is green on the same dot, the
textbook red-green failure, so the label is what makes them distinguishable and the
pulse is the second signal. `Badge` supplies the shape; it does not remove the
label or the pulse.

**Not adopted:** the voice-control consolidation (web `SegmentedControl` vs popup
`Select`) stays as the guidelines record it.

## Handoff

Planned. `plans/260821-0956-shadcn-everywhere-elevation-and-motion/` — six phases,
Phase 1 is the mock gate and Phase 2 may not start until it records real accepted
values. `/ak:cook` after review, carrying `--advice`.

## The gate this work must not skip

The previous round shipped to spec and still missed the user. It was specified in
words, accepted in words, and disliked on sight. Words have now failed twice.

The direction that _is_ accepted came from mock rounds — `visual-direction.html`,
`visual-directions-v2.html`, both in the deleted plans tree. That gate is what the
last round skipped.

User chose this gate. Built:
`plans/260821-0956-shadcn-everywhere-elevation-and-motion/mock.html` — the cascade panel rendered
twice side by side (today's hairlines vs proposed elevation), light and dark,
motion live and hoverable, plus the elevation and motion scales as reference
strips. Self-contained, opens from disk, degrades under
`prefers-reduced-motion`. Validated: CSS braces balanced, no undeclared custom
property, JS parses.

**No token is written until the user accepts a frame.**

### Amendment — a sliding indicator on the segmented control

Asked for after the first mock round. The user's earlier choice was "token scale +
micro-interaction sweep, no new motion"; a thumb that travels between segments _is_
a new motion, so this widens that tier by one item. Recorded rather than absorbed
silently.

Cause: `segment-control.tsx:78` carries `transition-colors` only, and selection is
painted by `data-[state=checked]:bg-secondary` on the item itself. Two elements
repainting says nothing happened; one element moving says the value changed. In the
mock the elevated column glides and the flat column still jumps, so the comparison
stays honest.

Implementation note for the plan — this is not a class change. `SegmentedControl`
wraps `RadioGroupPrimitive.Root`, so the thumb is an absolutely-positioned sibling
of the Radix items whose position must be **measured from real rects**, not derived
from the selected index: segments are text-width, and `Việt → Anh` / `Anh → Việt`
are not the same width. It needs a first-paint placement before the transition is
enabled (or the thumb animates in from the corner), plus re-measurement on resize
and on font load. The popup renders the same component inside 320px, so both
consumers get it at once.

## Also worth fixing while here

`docs/design-guidelines.md:29` and `tokens.ts:41` both cite
`plans/260820-1131-two-theme-palette/measure-palette.py` as the enforcement
authority. An evergreen doc citing a harness inside a stateful, deletable plans tree
is the real defect — it is why one `git rm` took the cited authority with it. When
palette or surface values are touched, re-home it as a committed check (a vitest
spec beside `token-parity.spec.ts`, computing contrast from `tokens.ts`) and fix
both citations. Not required for motion-only work.

## Unresolved questions

- Does the border shrink or disappear on elevated surfaces? `border on bg` measures
  1.34:1 — a hairline, droppable. But `borderControl` at 3.03:1 is a WCAG 1.4.11
  boundary on controls and cannot simply go.
- Does `radius` grow with elevation, or stay at 6/10/14?
