# Design guidelines

What the product looks like, and why each value is the value it is. The tokens
themselves live in `packages/ui/src/tokens.ts` and are consumed by web, the
extension and mobile; this document is where the reasoning is kept, because a
hex in a TypeScript file cannot say what it is for.

## Direction: editorial, ink for action, dawn for the mark

Direction A, chosen over four review rounds: an editorial page — a light serif for
headings, generous space, warm stone neutrals — where **ink is the single action
colour** and the only colour with any saturation is the **dawn** of the lotus mark
and the landing illustration. Colour marks the brand; it never marks a control.

The theme is the reader's choice — light, dark, or whatever the machine asks for.
Web and the popup offer the three; mobile follows the machine and offers no choice
yet (`apps/mobile/src/providers/theme-provider.tsx`). **The overlay follows nothing,
and that is the one exception worth understanding.**

The overlay renders on top of someone else's video, and inside a content script
`prefers-color-scheme` answers for the operating system rather than for the page it is
standing on. Following it would drop a white panel onto a dark call. So the overlay is
permanently dark, and it reads the dark palette (`color`) directly.

The accent appears **once per screen-state**, and a screen-state draws **at most two
elevated surfaces**. Hierarchy is carried by size, weight and space; the ink fill is
reserved for the single action a surface exists to offer, and the state colours for the
states that mean something. Both budgets are gated per screen-state by
`apps/web/src/design/accent-budget-app.spec.tsx` (counting through `accent-count.ts` and
`surface-count.ts`; its `KNOWN_VIOLATIONS` table is empty and fails a stale row), and
the landing per section by `apps/web/src/components/marketing/accent-budget.spec.tsx`.

**Surfaces are separated by depth, not by rules.** White cards on a near-white ground,
divided by hairlines, read as a line drawing rather than as a product; the owner chose
depth after seeing both. What that direction was protecting is kept: the translation is
still the largest thing on a translate surface, elevation is a scale of three, and no
shadow competes with text. See [Elevation](#elevation).

Every value here is measured. `apps/web/src/design/contrast-floors.spec.ts` reads the
palettes from `tokens.ts`, holds the pairs and the floors, and fails when one slips.

## Palette

Two values per token, one meaning. `color` in the token module is the **dark** half —
the overlay imports it directly and must never see the other. `colorLight` is the light
half, and `palettes` is the pair for the surfaces that let someone choose.

### Neutrals

Warm stone, hue about 30°.

| Token           | Light     | Dark      | Where                                            |
| --------------- | --------- | --------- | ------------------------------------------------ |
| `bg`            | `#F5F5F4` | `#0C0A09` | the page itself — stone, and night               |
| `surface`       | `#FFFFFF` | `#1C1917` | cards and panels                                 |
| `surfaceRaised` | `#EDEBE9` | `#252220` | a well (track) or a control resting on a surface |

Light `surfaceRaised` is **darker** than `bg` on purpose: the C1 wells — the segmented
track, the slider track — are cut into the page, not lifted off it. A field fills with
`surface` and draws a `border` edge instead (see [Control depth](#control-depth)). In dark,
`bg` → `surface` → `surfaceRaised` step upward and stay distinct from `border`.

### Borders

| Token           | Light     | Dark      | Where                             |
| --------------- | --------- | --------- | --------------------------------- |
| `border`        | `#DDDAD7` | `#2E2A27` | the hairline between two surfaces |
| `borderStrong`  | `#A8A29E` | `#57534E` | an emphasised divider             |
| `borderControl` | `#8A837E` | `#7C756F` | a boundary that must be found     |

### Text

| Token           | Light     | Dark      | On light bg | On dark bg | Where                             |
| --------------- | --------- | --------- | ----------- | ---------- | --------------------------------- |
| `text`          | `#1C1917` | `#F5F5F4` | 16.03       | 18.11      | headings and the translation      |
| `textSecondary` | `#57534E` | `#C4BFBA` | 6.99        | 10.83      | supporting prose, the source line |
| `textMuted`     | `#6B6560` | `#A8A29E` | 5.27        | 7.83       | hints and field labels            |

### Accent

The accent is **ink**: the same hex as `text` in each scheme.

| Token          | Light     | Dark      | Where                                       |
| -------------- | --------- | --------- | ------------------------------------------- |
| `accent`       | `#1C1917` | `#F5F5F4` | the one filled action on a screen           |
| `accentHover`  | `#44403C` | `#FFFFFF` | that action, hovered                        |
| `accentText`   | `#1C1917` | `#F5F5F4` | the accent read as text, and the focus ring |
| `accentSubtle` | `#E6E1DB` | `#35302C` | a selected state's tint                     |
| `onAccent`     | `#FFFFFF` | `#0C0A09` | the label on the filled action              |

Two consequences follow from an accent that is the colour of text:

- **Colour no longer marks a link** (WCAG 1.4.1). The `link` variants of `Button` and
  `Badge` are underlined at rest, and hover thickens the line rather than revealing
  it. `packages/ui/src/react/skin-guard.spec.ts` asserts the underline.
- **The hover step is capped in dark.** Light lifts ink toward stone, 1.70:1 from the
  fill. Dark can only go lighter — `token-contrast.spec.ts` forbids a hover that loses
  contrast with its label — and `#FFFFFF` is as far as lighter goes from `#F5F5F4`:
  1.09:1. So the primary button also lifts 1px with a deeper shadow on hover, the same
  C1 gesture as the quiet button; under reduced motion the shadow change remains.

### Dawn

| Token      | Value     |
| ---------- | --------- |
| `peach`    | `#F4C5A8` |
| `lavender` | `#C8B8E0` |
| `mint`     | `#A7E5D3` |

`dawn` in `tokens.ts`. **Decorative only**: the lotus mark's centre petal, the landing
illustration, the surfaces tiles' band. They measure 1.44, 1.69 and 1.30:1 on stone, so
a dawn value is **never behind text, never on a control, and never carries a state**.
It is not a palette key, and the contrast table never sees it. The illustration's two
extra stops, sky `#A8C8E8` and rose `#E8B8C4`, are local to the lotus mark data and the
landing component; nothing else reaches for them.

### State

| Token           | Light     | Dark      | Where                          |
| --------------- | --------- | --------- | ------------------------------ |
| `live`          | `#B3291D` | `#E9635A` | recording, as text or a dot    |
| `liveFill`      | `#B32E23` | `#C9433A` | the Stop button                |
| `onLiveFill`    | `#FFFFFF` | `#FFFFFF` | the label on Stop              |
| `liveSubtle`    | `#FBEAE8` | `#3A1B18` | the ground of an error notice  |
| `speaking`      | `#0F6B3E` | `#45B97C` | a translation is playing       |
| `warning`       | `#7A4E00` | `#E9A23B` | a step the reader still has    |
| `warningSubtle` | `#FBF0D8` | `#3A2A0C` | the ground of a warning notice |

Unchanged by the rollout: every floor still clears on the stone and night grounds.

### Overlay-only

| Token            | Value                       | Why it is separate                                                                                  |
| ---------------- | --------------------------- | --------------------------------------------------------------------------------------------------- |
| `overlay.bg`     | `rgba(12, 10, 9, 0.94)`     | night, translucent, so a bright video frame still reads through the panel rather than being blocked |
| `overlay.border` | `rgba(255, 255, 255, 0.12)` | the panel's edge against arbitrary video behind it                                                  |

One value each, deliberately. These belong to the surface that has no second ground.

### What the measurements say

Read from the spec run, not recomputed by hand.

Body text reads **16.03:1** on stone and **18.11:1** on night. `textSecondary` reads
6.99 and 10.83; `textMuted`, the quietest tier, 5.27 and 7.83. The label on the primary
button reads 17.49 and 18.11.

`borderControl` is solved against `surfaceRaised`, the tighter of its two grounds: 3.14
light and 3.49 dark, clearing WCAG 1.4.11's 3:1. It is the edge of the controls
listed under [Control depth](#control-depth) that must be found without hovering; a
field's resting edge is the `border` hairline, and a quiet button draws neither.

`borderStrong` is a divider, not a boundary: 2.31 and 2.59 against a floor of 2.0.
`border` is a hairline: 1.28 and 1.39 against 1.2. The focus ring, `ring-ring/50` with
no offset, measures 3.21:1 worst-case in light (ink at 50% on `surfaceRaised`) and
4.38 worst-case in dark (on `warningSubtle`; `surfaceRaised` is 4.71 there).

**The achromatic-accent exemption.** The table used to require 60° of hue between the
accent and `live`/`speaking`, so the primary action could never be mistaken for a state
beside it. Ink has no hue a reader can see — `#1C1917` measures 24° and `#F5F5F4` 60°,
which is rounding noise — and holding those rows would have meant tinting the approved
ink until the arithmetic passed. So while the accent's chroma (max − min channel) is
under 8%, those rows are replaced by a **lightness** row: accent against each state
colour at 2.0:1 or more, the table's own floor for "visible, not a boundary". Measured:
2.71 (`live`) and 2.66 (`speaking`) in light, 3.01 and 2.27 in dark. An accent that
regains a hue gets its hue rows back automatically, and `live`/`speaking`/`warning`
never leave the hue table.

`destructive` keeps its own name although it carries the same value as `live`. They mean
different things, and merging them would turn a future divergence into a rename.

## Brand mark

The lotus mark, its variants, the size rule and the asset export are in
[brand-mark.md](./brand-mark.md). In short: ink below 32px, dawn from 32px, full-dawn on
a night tile and in the idle overlay pill — and never in place of the recording dot.

## Type

Web reaches these steps through **role-named** custom properties in `@theme`, not
through the token key names:

| Property             | Step      | Size |
| -------------------- | --------- | ---- |
| `--text-label`       | `xs`      | 11   |
| `--text-hint`        | `sm`      | 12   |
| `--text-body`        | `base`    | 14   |
| `--text-translation` | `md`      | 17   |
| `--text-heading`     | `lg`      | 22   |
| `--text-title`       | `xl`      | 28   |
| `--text-display`     | `display` | 44   |

`--text-display` is the landing's alone — the hero and the how-it-works ordinals — and
it is **web-only**: the popup
has no landing, so `apps/web/src/design/token-parity.spec.ts` lists it in `SURFACE_ONLY`
rather than demanding the extension declare a size it never sets. It exists because a
marketing page needs one size above every product screen's largest, and a hero is exactly
where someone reaches for `text-5xl` — which `app-skin-guard.spec.ts` refuses along with
the rest of the size-name family. Its line height is 1.2, like `--text-title`'s: 1.05
clipped the stacked diacritics of a Vietnamese headline (`Ế`, `Ộ`) against the line above,
and Newsreader at this size was checked in both languages at 1.2.

Its step key is `display`, not a number — the only one in the table that is not part of
the `xs…xl` run, because it is not a step above `xl` so much as a different job. And it is
**flat, not a `clamp()`**: every step here is a plain number so React Native can read it
and so the parity test can assert `Npx`. A hero that needs to shrink on a narrow screen
does it with a responsive utility at the call site, which keeps the token comparable.

**The names are load-bearing, and `xs…xl` is the wrong answer.** Tailwind already
owns utilities of those names at different values — token `sm` is 12 against
Tailwind's 14, `lg` is 22 against 18, `xl` is 28 against 20 — so declaring
`--text-sm` re-typesets every existing `text-sm` in the app in one commit, silently.
Role names collide with nothing and carry the meaning this table's own Step column
already assigns. `token-parity.spec.ts` compares each against `fontSize`, and the
entries must stay inside the _first_ `@theme inline` block: that spec matches
non-greedily, so a second block renders correctly and tests as absent.

**The call sites are swept.** `apps/web/src/design/app-skin-guard.spec.ts` holds web
and the extension to role names: the whole Tailwind size-name family and `text-[Npx]`
literals are refused.

The reader's text-size control scales the transcript, not the tokens: the `text-source`
and `text-target` utilities in `apps/web/app/globals.css` multiply `--text-body` and
`--text-translation` by `--reading-scale`, and `reading-scale.spec.ts` holds their
targets to declared variables.

A related naming trap, recorded so it is not reintroduced: the supporting-prose
token is `--prose`, **not** `--text-secondary`. `--color-secondary` already exists,
so Tailwind already generates a `text-secondary` utility — and it resolves to
`surfaceRaised`, near-black on a near-black ground. Naming the prose token
`--text-secondary` would put `text-prose`'s replacement one prefix away from an
invisible utility, with nothing at a call site to tell them apart, and nothing in
the parity test either: it checks declarations, not usages.

| Step   | Size | Role                                                       |
| ------ | ---- | ---------------------------------------------------------- |
| `xs`   | 11   | uppercase labels, folios                                   |
| `sm`   | 12   | hints, secondary metadata                                  |
| `base` | 14   | body, the source transcript                                |
| `md`   | 17   | the translation — the largest thing on a translate surface |
| `lg`   | 22   | section headings                                           |
| `xl`   | 28   | page title                                                 |

Weights: `400` body, `500` emphasis and the translation, `600` labels and
buttons. Nothing heavier.

### Two families

**Be Vietnam Pro** is the body face everywhere — body, controls, labels and every
translation line. Web self-hosts it through `next/font`; the popup ships the same family
as pinned woff2 subsets (`apps/extension/scripts/build-fonts.mjs`), and
`token-parity.spec.ts` holds the two to one family name.

**Newsreader** is the display face, **on web only**: `--text-display` and `--text-title`
at weight 300, `--text-heading` at 400, and the wordmark at 500 — applied with the
`font-display` utility beside the role size. It is a variable face loaded with its
optical-size axis (`opsz`), which is what makes a 44px headline and a 22px heading each
look drawn for their size, plus italic for the hero's "Be understood". Self-hosted through
`next/font`, so the landing makes no third-party request.

Where the serif is **not** used, and why:

- Body, controls and translation lines — they are read, not looked at, and Be Vietnam
  Pro is the face built for Vietnamese at text sizes.
- The popup — its font pipeline ships one family; the wordmark reaches it as an
  outlined SVG path instead of a second pinned subset.
- The overlay — it loads no font at all and keeps an explicit system stack, because it
  renders inside someone else's page and every byte is injected there.
- Mobile — out of scope for the brand rollout.

## Elevation

Three steps, each carrying both themes, and the two halves are **not the same shape**.

| Step | Light                               | Dark                                  | Where                                                     |
| ---- | ----------------------------------- | ------------------------------------- | --------------------------------------------------------- |
| `sm` | two tight layers at 5.5% and 4% ink | one anchor at 35% black               | a control, a selected segment — lifted just off its track |
| `md` | 5% at 4px plus 7.5% at 16px         | 42% at 14px, plus the inset highlight | a card or panel: the resting height of a surface          |
| `lg` | 5% at 8px plus 10% at 34px          | 50% at 30px, plus the inset highlight | something over the page — a dropdown, the overlay's panel |

**Dark does not use shadow for depth, because it cannot.** Black on `#0C0A09` is very
nearly invisible. Depth there comes from the luminance steps the palette already
owns — `bg` → `surface` → `surfaceRaised` — with the shadow reduced to an anchor and a
one-pixel `inset 0 1px 0` highlight standing in for the light a raised edge would
catch.

**This is why the palette did not move.** No elevation value is a palette entry: they
are translucent ink and translucent white, resolving against whatever they are laid
over. The contrast table is untouched by a change that alters how every surface reads.

`surfaceEdge.hairline` is `border` receding on a surface that a shadow now separates.
Composited on a card it measures 1.13:1 light and 1.16:1 dark — a hairline rather than
a boundary, so 1.4.11 does not reach it. `borderControl` is a different token and a real boundary —
see [What the measurements say](#what-the-measurements-say).

The scale is exercised: cards at `md` (`card.tsx` carries `shadow-elev-md` on the base),
the popover and the avatar dropdown at `lg`, controls and the selected segment at `sm`.

### Two ways to get this wrong, both silent

**`light-dark()` must wrap each layer's COLOUR, never the whole list.** It is a
`<color>` function, so `box-shadow: light-dark(<list>, <list>)` is invalid at computed
value time and resolves to `none` — in **both** themes. Tailwind compiles it without
complaint, and a regex-based parity test cannot tell the two spellings apart. Measured
in Chromium: the layer form paints in both themes, the wrapping form paints in neither.
`token-parity.spec.ts` now has a test named for exactly this.

**Reach elevation through the `--shadow-*` namespace, never an arbitrary property.**
The namespace composes into `--tw-shadow`, which `box-shadow` reads alongside
`--tw-ring-shadow`. Writing `[box-shadow:var(--elevation-md)]` overwrites the whole
declaration and takes every focus ring on the element with it — verified: the utility
form emits a 17-layer chain with the ring still in it.

## Spacing and radius

Spacing `4 / 8 / 16 / 24 / 32 / 48 / 64`. Radius `6 / 10 / 14 / full`.

Mobile's own scaffolding scales are gone: `apps/mobile/src/ui/theme.ts` maps colour
from `palettes` and re-exports no scale, so a screen imports these from `@chatofy/ui`.

## Control depth

**A field has a real edge. A button is an object sitting on the surface.**

|       | Field (`Input`, `Textarea`, `SelectTrigger`)      | Quiet button (`Button variant="outline"`) |
| ----- | ------------------------------------------------- | ----------------------------------------- |
| Fill  | `card` — lighter than the page, flush on a card   | `secondary`                               |
| Edge  | `--border` as a 1px inset ring (hairline)         | `--surface-hairline` as an inset ring     |
| Depth | `--inset-field`, a soft recess under the edge     | `--elevation-sm`, cast outward            |
| Hover | the edge turns to `primary` at 40%; nothing moves | lifts 1px to `--elevation-md`, fill steps |
| Focus | the edge turns to ink inside the 3px `ring/50`    | the 3px `ring/50`                         |
| Text  | `text-body`, and 16px under `pointer-coarse`      | `text-body`                               |

The edge is drawn with `inset-ring-*`, which composes into `box-shadow` beside the
recess and the focus ring rather than replacing either. The fill never changes on
hover: a field that greys when pointed at reads as disabled.

**16px under a touch pointer** because iOS zooms the whole page into any focused
field set smaller than that. It is keyed to `pointer-coarse`, not to a width: an iPad
zooms too, and the extension popup is narrow but never touched.

`skin-guard.spec.ts` holds the edge, the touch size and the no-fill-on-hover rule on
all three fields, plus the ink hover edge; `contrast-floors.spec.ts` holds `border` at
its 1.2 floor on `bg` and `surface` in both themes.

### Why the edge came back, and why it is not 3:1 (2026-10-27)

Direction **C1** drew no field edge: a field was told from a button by the direction
of depth alone, and its edge composited to **1.13:1** light and **1.16:1** dark,
under WCAG 1.4.11's 3:1. It was chosen over a measured alternative (C2, a real
`borderControl` edge) on the argument that depth carried the distinction.

In use it did not. The field filled with `bg`, so wherever a field stood on the page
itself — the join field on `/conference`, the search on `/history` — its fill was the
page's own colour, measured `rgb(245,245,244)` on both, and the box was findable only
by its placeholder. On a card it was a faint grey patch. Reported as "hard to see,
hard to use" and reversed to the C2 edge; the review and its before/after
screenshots are in `plans/reports/enhance-ux-ax-261027-1656-form-controls.md`.

The C2 edge in `borderControl` (3.14–3.49:1) then read as heavy in use — a dark
outline around every field. Four edges were compared on the `/translate` header
(`edge-variants/sheet.png` in that report's folder), and `borderStrong` (2.1–2.6:1)
was tried next; it still read as too dark at rest. The edge settled on the **`border`
hairline at rest, turning to `primary` at 40% on hover** — quiet until pointed at;
full ink was tried for hover and read as too dark beside the full-ink focus edge, so
hover and focus now differ by strength rather than both being ink. At rest that is **under WCAG
1.4.11's 3:1, chosen knowingly**; the `card` fill is what separates a field from the
page, and the ink hover edge and focus ring clear 3:1 by a wide margin. A later audit
that wants 3:1 at rest is choosing `borderControl` again, not tuning a value.

A borderless treatment for the `/translate` pane-header pickers was tried and
rejected: every select keeps the field edge, so the header pickers match the forms.

So no control carries a 3:1 edge at rest by default, and the focus
ring carries 1.4.11's state-indication half — `--ring` at the 50% it is drawn
at measures **3.21:1** worst case (light, on `surfaceRaised`).

One control state is still outside that floor. An `aria-invalid` control REPLACES the
ring rather than adding to it — `aria-invalid:focus-visible:ring-destructive/50` in
`input`, `select`, `textarea` and `button`; `checkbox`, `radio-group`, `toggle` and
`badge` tint it `aria-invalid:ring-destructive/20` instead. The `/50` ring measures
**2.18–2.45:1** on `bg`, `surface` and `surfaceRaised`. On a field the red 1px edge now
stays drawn underneath it at full strength, so an invalid focused field is still
bounded; the ring itself is unchanged, and closing it means raising the alpha or
moving `live`, a palette decision nobody has taken yet.

### Where `borderControl` is the edge

- **A control inside a filled notice.** `Alert`'s `live` and `warning` variants
  re-border their actions in the notice's own hue, at their own width, because the
  quiet button supplies no border. `skin-guard.spec.ts` holds both halves of it.
  The alternative — moving the hue to the fill — was rejected on measurement: the
  notice's ink on its own hue is 1.99:1 (dark `warning`), 2.43:1 (light) and
  2.71–3.01:1 on `live`, which fails 1.4.3's 4.5:1 for the LABEL of the button that
  opens the user's microphone.
- **A checkbox or radio**, whose shape _is_ its edge.
- **An invalid field or button**, where `aria-invalid` draws a 1px `destructive`
  ring — on a field, inside and outside its edge.

## Component states

Every interactive element defines all six, and none of them may be the only
signal:

- **default** — a field draws its `border` hairline; a button its elevation.
  An `accent` fill for the one primary action on a screen
- **hover** — one step up the neutral scale, or `accentHover` on an accent fill.
  A button also lifts; a field's edge turns to `primary/40` and its fill stays;
  a checkbox or radio's edge turns to `primary`
- **active** — a button presses; an accent fill, or the accent as a left rule on
  a selected row
- **disabled** — reduced opacity **and** the depth removed, so it does not read as
  merely dim on a dark background
- **focus-visible** — a 3px `ring` at 50%, composed _over_ whatever depth the
  control already has rather than replacing it
- **invalid** — driven by `aria-invalid`, so the visual state and the announced
  state cannot drift apart

The focus rule is the shipped one, `ring-[3px] ring-ring/50`, settled over an older
"2px `accentText` ring, offset 2px" that only a since-deleted app shell followed: `--ring`
carries the identification load on every quiet button, and one rule beats the better of two.

Focus-visible is mandatory in the overlay specifically, and is worth stating
separately: it sits on a page whose own styles guarantee nothing, so a control
that relies on the host page's focus treatment has none.

## Where a component lives

`@chatofy/ui/react` is rendered by `apps/web` and by the extension's **popup**.
It is not rendered by the extension's **overlay**, which draws itself from a
hand-written string into a closed shadow root, and it is unreachable from
`apps/mobile`, which is React Native and imports only the root token entry.

**Everything web and the popup render is shadcn, or is composed only from shadcn.**
Nothing hand-rolls its own structure any more.

Two kinds of thing live behind that subpath, and the difference decides who may
change one:

- **Primitives** — `Accordion`, `Alert`, `Avatar`, `Badge`, `Button`, `Card`,
  `Checkbox`, `DropdownMenu`, `Input`, `Label`, `Popover`, `RadioGroup`, `Select`,
  `Separator`, `Sheet`, `Sidebar`, `Skeleton`, `Slider`, `Switch`, `Tabs`, `Textarea`,
  `Toggle`, `ToggleGroup`, `Tooltip`. Generated by the shadcn CLI, then re-skinned. They carry no
  product vocabulary: a primitive that knows what a meeting is has been written in the
  wrong place.
- **Compositions** — `LanguagePairPicker` (on `Button`), `SegmentedControl` and
  `ThemeToggle` (on `ToggleGroup`), `StatusIndicator` (on `Badge`), and `BrandMark` /
  `BrandWordmark` (on `brand-mark.ts` / `brand-wordmark.ts`; web sets the wordmark as
  live text, so only the popup renders `BrandWordmark`). This product's
  own, and they live here for one reason only: **both DOM surfaces render them.** Not
  "it seems reusable" — two real consumers, today. A composition with one consumer
  belongs in the app that consumes it.

  Two of them take a `labels` prop defaulting to English: `ThemeToggle` and, since the
  Vietnamese locale landed, `LanguagePairPicker`. That is the arrangement a composition in
  this package must use when it says words — the popup renders it and has no dictionary,
  so it keeps working unchanged, while web passes the reader's words down. A composition
  that reached for a translation itself would have to know which of two surfaces it was
  on, which is exactly what living here means it cannot know.

`Tabs` ships with **no consumer**, and so do `Accordion` and `RadioGroup` — nothing in
either app or in this package imports them. `Tabs` is kept deliberately, so the shape exists when a surface
finally switches between panels of content. Nothing does today: `/translate`,
`/history` and `/preferences` are routes, which is the right answer for something that
should have a shareable URL and answer to the back button. It is emphatically not what the segmented
controls are built on — they set a value and reveal no panel, and Tabs without a
tabpanel announces "tab, 1 of 2" to a reader who then looks for content that does not
exist.

`Select` is the shape for a choice among many named things: web's voice and AI Context
pickers (`translate/voice-picker.tsx`, `translate/context-picker.tsx`) and the popup's
AI Context picker (`settings-pane.tsx`). A choice between two named things is a
`SegmentedControl` instead — see _No longer duplicated_ below.

Its trigger **follows the field**, not the button: the same fill, edge and states as
`Input`, 40px. A select shows a chosen value, which is what a field does, and stands
in a form column beside `Input`. The chevron says it opens, so it is drawn at full
`muted-foreground` and never faded further. Rows in the open list — and in every
`DropdownMenu` — are 36px, 44px under `pointer-coarse`, and the highlighted row is
`accentSubtle`, which a reader can find on the card where `secondary` was 1.19:1.

**A control's label is `text-body` medium, sentence case** — `Label`, or the same
classes on a `<span>` that names a Select or a SegmentedControl. A per-column
sub-label (Source / Translation, the glossary's languages) is `text-hint` muted. The
11px uppercase `text-label` is for SECTION headings only: Vietnamese capitals with
their diacritics at 11px were the hardest text on the settings screens.

A field's own error message is `text-destructive` and named by the field through
`aria-describedby`; set in the hint's muted grey it read as one more piece of advice.

`sidebar.tsx` is the largest of them and ships **variants nothing renders** — the
`floating` and `inset` looks, the right-hand side, `SidebarGroupLabel`, `SidebarInput`,
`SidebarMenuBadge`. Generated whole by the CLI and left whole on purpose: editing a
generated primitive forks it from the upstream the next `shadcn add` would rewrite, so
the unused parts stay and the call sites simply do not reach for them. `SidebarGroupLabel`
in particular is a decision rather than an omission — see `app-sidebar.tsx`.

None of this is reported by `knip`, and not because of an exception: they are exports of
the `./react` entry point, and knip treats a package's declared public surface as used.
So nothing mechanical will notice a consumer-less primitive appearing — this paragraph is
the only record, and it has to be updated by hand.

### The two surfaces that cannot take a shadcn component

Neither is an oversight, and both have a test that says so.

**The overlay.** `apps/extension/src/overlay-invariants.spec.ts` asserts its sheet
contains no `var(`. Every Tailwind utility emits a custom property, and `all: initial`
does **not** reset custom properties — they cross the shadow boundary deliberately, as
a public styling interface. A Tailwind-themed overlay is therefore repaintable by the
meeting page, _including the recording indicator the page must not be able to touch_.
This is a security invariant, not a styling preference. Importing a component here
"for consistency" is the specific mistake to not make.

The overlay does read `elevation` and `motion` — interpolated as literals, and only
the **dark** half. `elevation.md.dark`, never `elevation.md`: a `light-dark()` in that
sheet would make a permanently-dark surface follow the operating system.
`overlay-invariants.spec.ts` refuses `colorLight` and `palettes` in `overlay-styles.ts`,
but not a light elevation half, so that one is a rule for the person writing it.

**`apps/mobile`.** React Native, no DOM. `react/index.ts` records that it must never
resolve React, Radix, or any DOM type; the subpath split exists for this.

### A behaviour the primitive gets wrong, and where it is corrected

Radix's `ToggleGroup type="single"` renders `role="radiogroup"` with `role="radio"`
items and `aria-checked` — the same ARIA contract `SegmentedControl` had when it
wrapped `RadioGroup` directly. The move cost nothing there, which is the opposite of
what was expected when it was proposed.

The behaviour does not follow the role. Radix uses roving focus: arrows move focus and
selection waits for Enter, Space or a click, so the control announces "radio, 1 of 3"
and then ignores the arrow key that announcement invites. `segmented-control.tsx` wires
arrows back to selection rather than shipping the mismatch. That handler is the most
deletable line in the file — nothing breaks visually without it, nothing fails to
compile — so `segmented-control.spec.tsx` carries a test named for the behaviour rather
than for the key.

Compositions are **controlled**. `ThemeToggle` takes a value and reports a click;
it does not read storage. The web reads `localStorage` synchronously so the
server's first render and the client's agree, while the extension reads
`chrome.storage` and gets an answer a tick later — no single component can own
both, so it owns neither. `value` may be `undefined`, which is the hydration-safe
state: one frame showing no selection beats one frame showing the wrong one.

### Re-skinning a generated component

The CLI writes stock shadcn. Four things in its output are wrong here, and **all four
are banned** by `packages/ui/src/react/skin-guard.spec.ts`; `app-skin-guard.spec.ts`
repeats the size-name and `bg-primary/\d` bans for the apps, and `dark:` for the
extension. The `bg-primary/\d` ban caught a violation shipping in `badge.tsx` — the
argument for turning a review rule into a spec whenever it can be written as one.

The full `FORBIDDEN` list is `dark:`, `bg-accent`, `text-accent-foreground`,
`bg-popover` / `text-popover-foreground`, `border-input`, `text-sm` / `text-xs`,
`bg-primary/\d`, and the `@/lib/utils` alias.

The same spec also holds two rules that are the opposite shape — things a component
must **carry**, which a ban cannot express:

- a filled `Alert` re-borders its actions in the notice's own hue
  (`[&_[data-slot=button]]:border-live` / `border-warning`). Against the previous
  palette `borderControl` on `warningSubtle` / `liveSubtle` fell under 1.4.11's floor;
  the stone palette lifts it to 3.05–3.43:1, so the hue border is now margin rather
  than rescue. `contrast-floors.spec.ts` cannot hold it either way, because it
  measures token pairs rather than which token a component asks for
- anything using `transition-*` or `animate-*` carries a `motion-reduce:` escape.
  The CLI writes neither, so a generated component moves for a reader who asked
  the operating system for stillness, and nothing else fails

| Stock shadcn                          | This project                           | Why                                                                                                                                                          |
| ------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hover:bg-primary/90`                 | `hover:bg-accent-hover`                | fading a filled button on a dark ground reads as disabled, not as hovered. Banned as `bg-primary/\d` in both guards                                          |
| `bg-accent`, `text-accent-foreground` | `bg-secondary`, `bg-muted`             | shadcn's `--accent` is a pale grey hover surface; here the accent is _the_ accent, and a screen gets one accent-filled control                               |
| `dark:` variants                      | `light-dark()` tokens                  | the palette is one declaration carrying both halves, and "follow the machine" carries no class — a `dark:` utility never fires while every token still flips |
| `text-sm`, `text-xs`                  | `text-body`, `text-hint`, `text-label` | the scale is by role, not by size; see [Type](#type)                                                                                                         |

Also `bg-popover` and `border-input`, which name tokens this palette does not
define. And imports must be relative: the `@/lib/utils` alias the CLI writes
resolves for the bundlers but not for `rollup-plugin-dts`, so it breaks only the
type build.

### No longer duplicated

**Voice was two different controls, and now is one.** The web rendered a
`SegmentedControl` and the popup a Radix `Select`, recorded here as a deliberate
limit of the consolidation: the popup is 320px wide, and two segments were held to
cost a row the pane did not have.

Both halves of that turned out to be wrong.

The row is the same height either way — the label sits above the control in both
treatments, and the measured difference was about three pixels. And a dropdown
inside an extension popup is a portal inside a 320×600 window, where
`--radix-select-content-available-height` leaves almost nothing to open into: it
flashed open and closed again. A choice between two named things does not need a
menu, and the popup already renders `LanguagePairPicker` directly above it with the
same uppercase label and the same segmented shape.

The e2e suite is what makes this safe to change: it asserts the popup does not
scroll sideways at 320px across every state, and that Start stays above the 600px
cap. Both still pass.

## Reader appearance

On `/translate` the reader can restyle the transcript itself. There are two profiles: one for the
page, and one for the stage, which is what fullscreen and the floating caption window draw. They
live in `apps/web/src/lib/reading-appearance.ts`, and the controls sit in the display popover's
"Text & color" and "Captions" tabs.

- **Applied as variables, on one element.** `readingStyle` writes `--reading-*` next to
  `--reading-scale`. The `reading-*` utilities and `text-source` / `text-target` in
  `globals.css` read them, and every fallback is the old look. The default appearance writes
  no variable at all, which is why `/history` (same transcript, no variables) is unchanged.
  `reading-scale.spec.ts` holds each fallback.
- **Raw tokens, not `--color-*` aliases.** The reading utilities read `--foreground`,
  `--prose` and `--muted-foreground` directly. The aliases are declared on `:root` and
  arrive already resolved, so they would carry the page's scheme into a forced ground.
- **A ground can force a scheme.** A fixed ground forces its scheme from its own luminance:
  black, navy, white, or a custom hex. It adds `reading-scheme-dark` / `reading-scheme-light`,
  and the token block is declared on those two classes as well as on `:root`. The build
  compiles `light-dark()` into a toggle that resolves where a token is declared, so a token
  declared only on the root could never flip inside the island.
- **Presets are held to 4.5:1. Custom colours are measured, never refused.** Every ink preset
  clears 4.5:1 on `surface` and on every ground preset of its scheme. Every ground clears
  4.5:1 against the default text, secondary and muted inks (`reading-appearance.spec.ts`).
  A custom hex shows its ratio against the drawn ground, which is composited at its opacity.
  It warns in words when it falls under the floor, or when it fails in the theme not on
  screen.
- **Fullscreen is the page, bigger.** It keeps the page's arrangement (split or list, row or
  column) in the stage look. Headers name the pair as text, and speaker names are copies.
  A bar in a row of its own at the foot carries the status, Start / Pause / End, the display
  gear and the exit, so it covers neither the pane headers nor the newest line. It hides
  after 3 s alone by fading, keeping its row so the transcript never moves, and returns on
  any pointer move, tap or key. It stays up while it holds keyboard focus or while the
  gear's panel is open, but not for a pointer resting on it: after a click on Start that
  pointer stays put, and the bar never hid. The panel is portalled into the fullscreen
  element (`PopoverContent`'s `container`), because the browser draws nothing outside it.
  The dock is `inert` meanwhile and does not render its Start (`fullscreen-stage.tsx`).
- **The caption window is captions, not a page.** It shows one stream with no pane headers,
  pickers or attribution control. The session stays on the page.
- **The stage look.** By default it uses a black ground, a bold translation and text size
  6/10, and "Same as page" mirrors the page profile instead.
- **One accent.** The fullscreen and caption-window buttons are outline controls in the dock.
  In fullscreen, Start (or Resume) in the bar is the one filled control, the gear is outline
  and the exit is ghost. A chosen swatch shows a ring, never a fill.

## Motion

**Never in the way of reading a translation.** That invariant is the whole of what
survives from the previous rule, and it still decides every case: no continuous motion
beside transcript text, no animating a line while it is being read, and an entrance for
a settled line that is transform and opacity only.

What replaced the rest was a whitelist of four permitted motions. It was not a scale —
there were no duration or easing tokens at all, so everything animated ran on Tailwind's
default 150ms because no call site had anything else to ask for, and nothing was in step
with anything. `tokens.ts` now carries `motion`:

| Token             | Value                        | Where                                                                       |
| ----------------- | ---------------------------- | --------------------------------------------------------------------------- |
| `duration.fast`   | 120ms                        | hover, focus, press — a response, not an animation                          |
| `duration.base`   | 200ms                        | a notice arriving, a control changing state, the segmented thumb travelling |
| `duration.slow`   | 320ms                        | a status colour crossfading, a settled transcript line entering             |
| `easing.standard` | `cubic-bezier(0.2, 0, 0, 1)` | the default                                                                 |
| `easing.enter`    | `cubic-bezier(0, 0, 0, 1)`   | entering — decelerating into place                                          |
| `easing.exit`     | `cubic-bezier(0.3, 0, 1, 1)` | leaving — no lingering                                                      |

**`--ease-*` is a Tailwind theme namespace and `--duration-*` is not.** Declaring
`--duration-fast` in `@theme` mints no utility — no error, no warning, nothing. The
surfaces define role-named `@utility` rules over plain `:root` properties instead.
Measured against the installed Tailwind rather than inferred from the two names looking
alike.

Everything is behind `prefers-reduced-motion: reduce`, and that is verified rather than
asserted: a Chromium context with `reducedMotion: 'reduce'` finds zero elements
transitioning or animating on `/translate`. When checking this yourself, read
`transitionProperty` and `animationName` — **not duration**. `transition-none` sets
`transition-property: none` and leaves the duration declared but inert, so a
duration-based check reports every correctly guarded element as still moving.

**One entrance, on the landing only: the lotus opening.** The hero's five petals start
upright and turn out to their resting angles once on load — 1000ms on `easing.enter`
(`--animate-lotus-bloom` in `globals.css`) — and then stay still. No loop, nothing
reacts to the pointer, and it is marketing-only: no product screen carries it, and it
never runs beside a translation. Every petal pairs it with `motion-reduce:animate-none`,
which leaves the resting angle (an inline transform) in place from the first frame;
`lotus-illustration.spec.tsx` asserts the pairing, and the Chromium check above finds
zero animating elements on `/` under reduced motion.

## Copy register

What the product may say out loud. The rule: **name the wait, the outcome, or the
next step — never the pipeline.** The exemplar came from the popup's mode note,
which was deleted along with the selector it explained — so this is now the only
place it survives, which is why it was copied here before the deletion:

> "Waits for a sentence to finish before answering." — and its comment notes the
> line used to describe its pipeline ("recognise, translate, speak"), "which is a
> fact about the implementation, not about the wait."

That is the whole principle. The paired live line —
"Answers about three seconds behind and talks over pauses — wear headphones." —
names a consequence the reader can act on.

Backend names, measurement instruments and mechanism explanations are therefore
not user-facing vocabulary. Identifiers are exempt: `CascadePanel` is a component
name, not a word the product says. Only rendered strings are in scope.

Every string this rule once flagged is gone from the product: the `Cascade` / `Live`
mode choice (web and popup), the `Turn-based baseline` route name, the
`heard during playback` counter and its barge-in tooltip, the live panel's
pipeline-and-latency copy, and the popup's `Report timings for measurement` checkbox
(the `reportMetrics` flag and its code path are kept).

**Language codes are never user-facing.** Codes still enter the app as data — a
language pair is `{ source: 'vi', target: 'en' }` — and become words only through the language registry
(`packages/types/src/domain/languages.ts`) or the dictionary's `common.languageName.<code>`
keys.

**Exempt, with reasons.** Safety text keeps its meaning even when its register
changes: the recording disclosure (`popup/index.html:39-57`), and the overlay's
reload-recovery instruction, which is two steps because reloading discards the
`activeTab` grant `tabCapture` needs — saying only "reload" walks the reader into a
trap. Shorten either at your peril; a reviewer who cannot restate the consequence
after reading the new copy has found the line that must not change.

### Under two languages

Every user-facing string on web now lives in `packages/i18n`, in both `en.ts` and
`vi.ts`, and four rules follow from that.

**The register governs each locale independently.** Review a Vietnamese string against
the rule above, never against fidelity to the English. English is the reference for
MEANING, not for structure — and a natural Vietnamese rendering of a wait description is
exactly where the banned copy creeps back, because "nhận dạng rồi dịch rồi đọc" reads
perfectly well and says the wrong kind of thing.

**The reviewer test generalises.** Someone who cannot restate the consequence FROM THE
VIETNAMESE ALONE has found a bad translation, not a stylistic quibble. That is the same
test the exemptions above use, applied one locale at a time.

**Language names are locale-dependent**, where codes were merely banned.
`LanguagePairPicker` defaults to the registry's English interface name (`label`:
"Chinese"), which is right for the popup with no locale. Everywhere on web — the
pickers (`languageNamer` in `apps/web/src/i18n/language-pair-labels.ts`), history rows and
glossary columns — a language is the interface locale's `common.languageName.<code>`.
Not the language's own name: "简体中文" is unreadable to most of the readers choosing it.

**The register of address is neutral "bạn"**, everywhere. Not "quý
khách", which is the register of a bank and wrong for a tool used daily, and not
pronoun-avoidance, which is harder to keep consistent than it looks and drifts into
passive constructions.

A mechanical half exists: `apps/web/src/components/marketing/landing-copy.spec.ts` runs
the ban list — pipeline vocabulary, component and engine names, measurement instruments,
language codes — against the landing dictionary. It checks English only today; pointing
it at every locale is a one-line change and worth making.

**Mail copy is not in this dictionary**, and that is deliberate:
`apps/api/src/modules/mail/interfaces/mail-sender.interface.ts` owns all four templates
in both languages, keyed purpose-first so `tsc` names a purpose added in one language
only. Nothing there is ever rendered in a browser, and putting it in the web app's
dictionary would put mail copy on a surface that does not send mail.

## State inventory

Every state a surface can be in, and where it renders. An entry is either a
`file:line` or an explicit "not applicable, because …". A blank is a defect — this
table is what catches a surface that looks unfinished because nobody drew its empty
or error case.

**Popup** (`extension/entrypoints/popup/`)

| State                         | Renders at                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| consent unseen                | `index.html:39-57` `#consent`; `popup.tsx:18,30` hides header, settings **and** footer, `:70` disables Start    |
| signed out                    | `popup.tsx:23,51` — `SignInPane`; settings and footer hidden                                                    |
| meeting tab, idle             | `popup.tsx:70` Start enabled by `captureable`; `popup-status.ts` says "Ready."                                  |
| meeting tab, capturing        | `popup.tsx:44-47` `StatusIndicator` tone `live`; `:64` the button turns Stop                                    |
| non-meeting tab               | `settings-pane.tsx:83-86` default `Alert` with `support.message`; Start disabled                                |
| Zoom-desktop tab              | same `Alert`, `support.kind === 'action'` → `warning` variant                                                   |
| site switched off (`Runs on`) | `use-popup.ts:142` `captureable` false; `popup-status.ts:51` names the site                                     |
| a leg failing                 | `popup-status.ts:15` `firstFailure` — capture, then meeting audio, then microphone                              |
| microphone notice             | `settings-pane.tsx:165` — only when `microphoneNeeded`                                                          |
| `main` scrolls on / off       | `settings-pane.tsx:63-68` `data-scrolls`, re-measured after every render, so any content-height change moves it |

**Overlay** (`extension/entrypoints/content/`)

| State                                       | Renders at                                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| pill, idle                                  | `overlay.ts:252-260` — the lotus `pill-mark`; part chosen at `:423` by `visibleOverlayPart` (`src/site-enablement.ts`)                                                         |
| pill, live                                  | `overlay.ts:430` `.pill.live` — the pulsing dot replaces the mark; the undismissable capture signal when collapsed                                                             |
| panel, idle, empty                          | `overlay.ts:268` `.panel`; `renderLines` (`:501`) writes "Not capturing."                                                                                                      |
| panel, capturing, empty                     | same, "Listening…", indicator visible                                                                                                                                          |
| panel with turns, incl. `.mine` and `.live` | `overlay.ts` `renderLines` (text nodes only)                                                                                                                                   |
| error bar — capture / inbound / outbound    | `overlay.ts:474` `renderErrors` renders **one line per failing leg**, deliberately: one line cannot say the meeting translates fine while nothing the user says reaches anyone |
| outbound `sending`                          | `overlay.ts:60`                                                                                                                                                                |
| outbound `muted`                            | `overlay.ts:61-62`                                                                                                                                                             |
| outbound `patched: false`                   | `overlay.ts:64-67` — the two-step reload instruction                                                                                                                           |

**Web** (`apps/web/`)

Every row below was verified against source when it was written. Add none you have not
opened — a wrong address is worse than a missing one, because it looks checked.

**Locale does not multiply this table.** Each surface has one set of states, rendered in
whichever language the request resolved to; there is no Vietnamese-only state and no
English-only one. What WOULD be a defect is a state whose copy exists in one locale and
not the other, and for dictionary strings that cannot happen: `packages/i18n/src/vi.ts`
is typed `Messages`, so a key present in `en` and missing in `vi` fails `tsc` by name.
That guarantee is exactly as strong as the number of strings living outside the
dictionary, which is the argument for keeping that number at zero.

| State                                      | Renders at                                                                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` signed out                             | `layout/marketing-header.tsx` — "Sign in" ghost, "Get started" quiet (outline); the header spends no accent, gated at 0 by `accent-budget.spec.tsx`, because the hero's one filled button shares its viewport |
| `/` signed in                              | same line, the other branch: one "Open Chatofy" at `/translate`                                                                                                                                               |
| landing, mobile nav closed / open          | `layout/marketing-menu.tsx:47` — the sheet; the desktop nav is hidden below `lg`                                                                                                                              |
| `/translate` mic refused                   | `translate/readiness-banner.tsx` `microphoneFault` — the banner speaks, otherwise silent                                                                                                                      |
| `/translate` mic not asked / unknown       | same function — and neither is a fault, so neither renders anything                                                                                                                                           |
| `/translate` mic absent                    | same function — no `audioinput` device; a refused permission still wins over it                                                                                                                               |
| `/translate` service reachable             | nothing renders; a probe still in flight is not a problem to report                                                                                                                                           |
| `/translate` service unreachable           | `translate/readiness-banner.tsx` — a failed `GET /health`, and a hung one after 5s                                                                                                                            |
| sidebar expanded / rail                    | `layout/app-chrome.tsx:50` `opensExpanded` — the route decides, not a cookie                                                                                                                                  |
| sidebar mobile sheet                       | `packages/ui/src/react/sidebar.tsx:171` — the primitive swaps to a `Sheet` below `md`                                                                                                                         |
| session menu loading                       | `layout/session-menu.tsx` — a `Skeleton` at the avatar's size, never `null`                                                                                                                                   |
| `/translate` idle                          | `translate/cascade-panel.tsx:97` `STATUS_KEY.idle`                                                                                                                                                            |
| connecting                                 | `STATUS_KEY.connecting`                                                                                                                                                                                       |
| listening / hearing speech                 | `STATUS_KEY.listening`, `'hearing-speech'`                                                                                                                                                                    |
| translating                                | `STATUS_KEY.translating`                                                                                                                                                                                      |
| playing                                    | `STATUS_KEY.playing`                                                                                                                                                                                          |
| display popover closed / open              | `translate/display-settings-popover.tsx` — the gear at the end of the dock; non-modal, so the transcript stays readable                                                                                       |
| voice popover closed / open                | `translate/voice-settings-popover.tsx` — the speaker in the panel header, glyph swapped on `voiceOutput`; also non-modal                                                                                      |
| `/translate` panel headers, idle / running | `translate/panel-headers.tsx` — the language pair, named permanently; the swap goes dead mid-conversation                                                                                                     |
| voice popover open mid-conversation        | `translate/voice-settings-panel.tsx:89` `disabled={running}` — everything but volume is frozen; the language pair with it, at `translate/panel-headers.tsx:190`                                               |
| transcript empty                           | `translate/conversation-transcript.tsx:216` — copy differs on `running`                                                                                                                                       |
| running with turns                         | same component, the turn list                                                                                                                                                                                 |
| error notice                               | `translate/cascade-panel.tsx:391` — a `live` `Alert` (`role="alert"`)                                                                                                                                         |
| `/preferences` defaults section            | `preferences/conversation-defaults-section.tsx` — the same panel, `running={false}`; one of the screen's two elevated surfaces                                                                                |
| `/preferences` interface section           | `preferences/interface-preferences-section.tsx` — language and theme, on the page ground                                                                                                                      |
| `/preferences` AI Context library          | `preferences/ai-context-section.tsx` — the other surface; the editor expands inline, so editing stays at two                                                                                                  |
| `/account` identity loading                | `account/account-identity.tsx` — the header paints at once; only the join date holds a place                                                                                                                  |
| `/account` identity loaded                 | same component; name and email paint from the session before the profile lands                                                                                                                                |
| `/account` profile lookup failed           | `account/account-screen.tsx` — reported on the join-date line, and nobody is signed out for it                                                                                                                |
| any route, error boundary                  | `app/(app)/error.tsx`, `app/(auth)/error.tsx`, `app/(marketing)/error.tsx`                                                                                                                                    |
| any address that is not a route            | `app/not-found.tsx`                                                                                                                                                                                           |

`/history`, `/history/[conversationId]` and the AI Context states on `/translate` are
enumerated as the `SCREENS` rows of `apps/web/src/design/accent-budget-app.spec.tsx`,
which mounts each one.

Not reachable without a backend or a forced value: `connecting`, `translating`, and
the readiness banner's `unreachable`. There is no Playwright in `apps/web` and none is
being added, so those are reviewed against a temporarily forced value — stated here so
a screenshot set is not mistaken for a harness.
