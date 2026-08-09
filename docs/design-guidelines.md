# Design guidelines

What the product looks like, and why each value is the value it is. The tokens
themselves live in `packages/ui/src/tokens.ts` and are consumed by web, the
extension and mobile; this document is where the reasoning is kept, because a
hex in a TypeScript file cannot say what it is for.

## Direction: dark, with a cool accent

Not a taste call on its own. The meeting overlay renders on top of someone
else's video and can never follow `prefers-color-scheme` — inside a content
script that setting reflects the operating system, not the page, so a user with
a light OS in a dark Meet would get a white box over the call. The overlay is
therefore permanently dark. If web were light, the two surfaces could never read
as the same product, so web is dark too.

Light is **deferred, not rejected**. `@custom-variant dark` stays in
`apps/web/app/globals.css` so a light theme can be added later without
re-deriving the machinery.

## Palette

### Neutrals

| Token           | Value     | Where                                                          |
| --------------- | --------- | -------------------------------------------------------------- |
| `bg`            | `#0C0C0E` | the page itself                                                |
| `surface`       | `#111113` | cards, panels, the overlay body                                |
| `surfaceRaised` | `#17171A` | something sitting on a surface — a control bar, a selected row |

### Borders

Three, because they do three different jobs and one value cannot serve all of
them at an accessible contrast.

| Token           | Value     | On `surface` | Where                                                                |
| --------------- | --------- | ------------ | -------------------------------------------------------------------- |
| `border`        | `#26282D` | 1.28         | separation between regions. Decorative; nothing depends on seeing it |
| `borderStrong`  | `#35373D` | 1.59         | emphasis, a hovered edge                                             |
| `borderControl` | `#63666F` | 3.29         | the edge of anything you can click or type in                        |

`borderControl` exists because WCAG 1.4.11 wants 3:1 for the boundary of a user
interface component, and `border` is nowhere near it. A card outline can be
faint; the edge of a select cannot, or there is no way to tell it is a select.

### Text

| Token           | Value     | On `bg` | On `surface` | Where                                                 |
| --------------- | --------- | ------- | ------------ | ----------------------------------------------------- |
| `text`          | `#EDEEF0` | 16.83   | 16.25        | the translation, headings, anything that is the point |
| `textSecondary` | `#B4B6C0` | 9.67    | 9.33         | the source transcript, supporting prose               |
| `textMuted`     | `#8B8D98` | 5.92    | 5.71         | labels, hints, timestamps                             |

All three clear AA (4.5:1) at every size, including the 11px uppercase labels —
`textMuted` at 5.71 on `surface` is the floor and it holds. There is no size
below which one of these becomes unsafe.

### Accent

| Token          | Value     | Contrast           | Where                                                           |
| -------------- | --------- | ------------------ | --------------------------------------------------------------- |
| `accent`       | `#00A2C7` | 6.51 on `bg`       | fills — primary buttons, the selected segment, a level meter    |
| `accentHover`  | `#23AFD0` | dark on it 7.55    | hover state of the above                                        |
| `accentText`   | `#4CCCE6` | 10.32 on `bg`      | accented **text** — links, a speaker label, the focus ring      |
| `accentSubtle` | `#0B2B38` | `text` 12.77       | background of a selected chip or a mode notice                  |
| `onAccent`     | `#0C0C0E` | 6.51 on `accent`   | **dark** ink sitting on an accent fill                          |
| `onLiveFill`   | `#FFFFFF` | 4.93 on `liveFill` | white ink on the red fills — the indicator bar, the Stop button |

The accent was `#6E56CF` until the extension redesign, and the replacement
inverts the rule the violet set rather than just moving a hue. Violet was dark:
it took white text and could not be read on the background, so `accent` was
fills-only and `accentText` existed to carry the contrast the fill could not.
Cyan is bright. It reads 6.51 on `bg`, so it is legible as text as well; and it
reads 3.00 against white, so it cannot carry white at all.

Two consequences, and both are load-bearing:

- **`onAccent` is dark.** There is no cyan both bright enough to be read on the
  page and dark enough to take white. Reaching for `#FFFFFF` on an accent fill
  now fails AA at 3.00.
- **`onLiveFill` had to be split out.** `onAccent` used to serve every fill in
  the product because every fill wanted white. The red bars still want white —
  `liveFill` at 4.93, `live` at 4.99 — so they now name their own ink. Any fill
  added later must say which of the two it takes; there is no default.

`accentText` is no longer a contrast fix, since the fill already clears AA. It
is a size fix: an 11px uppercase label at 6.51 is legible without being
comfortable, and a focus ring drawn in the same colour as the button it
surrounds is not a ring.

`accentHover` goes **brighter**, which for a dark-ink fill also means safer —
7.55 on hover against 6.51 at rest, so the state someone is about to click is
the more legible of the two. Under the violet this trade ran the other way and
the obvious step up the ramp had to be rejected for putting white at 4.38.

### State

This product has states a generic palette has no name for, and each gets exactly
one colour used the same way on every surface.

| Token           | Value     | Means                                                                                                                          |
| --------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `live`          | `#E5484D` | capture is running; also the stop action. 4.99 on `bg` as text or a dot                                                        |
| `liveFill`      | `#D13438` | anything with `onLiveFill` text ON it — the capture indicator bar, the Stop button. 4.93; `live` itself would be 3.91 and fail |
| `liveSubtle`    | `#3B1219` | background of a live-state notice                                                                                              |
| `speaking`      | `#30A46C` | a translation is playing. 6.19 as text; dark text on it as a fill is also 6.19                                                 |
| `warning`       | `#FFB224` | the user has something left to do — grant the microphone, reload the page                                                      |
| `warningSubtle` | `#3B2400` | background of a warning notice                                                                                                 |

**`live` and `speaking` must never be distinguished by colour alone.** They are
red and green, adjacent, and often rendered as a status dot — the textbook
red-green failure. Every place they appear carries a text label as well, and the
two differ in behaviour: `live` pulses, `speaking` does not. A reviewer who
suggests the label is now redundant because there is a colour is wrong, and this
sentence exists so that is a one-line answer.

The cyan accent narrows a second gap the violet used to keep open: `speaking`
(`#30A46C`) against `accent` (`#00A2C7`) is green against cyan rather than green
against purple. It is tolerable only because the labelling rule above already
holds everywhere. If a use ever needs to be read at a glance without its label,
`speaking` moves — the rule does not.

`destructive` on web keeps its own name even though it currently carries the
same hex as `live`. They are different meanings, and merging them would turn a
future divergence into a rename.

### Overlay-only

| Token            | Value                       |
| ---------------- | --------------------------- |
| `overlay.bg`     | `rgba(17, 17, 19, 0.94)`    |
| `overlay.border` | `rgba(255, 255, 255, 0.12)` |

A separate group because the overlay is translucent over arbitrary video and
permanently dark, which is true of nothing else. When it is illegible over a
bright video frame the fix is more opacity here, never a lighter text token —
those are shared with web.

Two things are deliberately **not** tokens: the overlay's `z-index` and its font
stack. Both are overlay-local, and an overlay that inherits the meeting page's
font gains an injection surface it does not need.

The `live` / `liveFill` split is the same idea as the accent one, and easy to get
backwards. `live` is for a thing drawn **on** the background — text, a dot, a
left rule. `liveFill` is for a thing the background is drawn **under**. Reaching
for `live` as a button fill puts the least legible text on the page under the
control someone uses to stop a recording.

## Type

Web is a **known exception**: it uses Tailwind's own scale plus a few literal
sizes rather than these steps, because no `--text-*` entries were added to
`@theme`. The extension interpolates the real scale. That divergence is recorded
rather than fixed — closing it means adding the scale to `@theme` and sweeping
every utility, which is a change of its own.

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

Web uses a self-hosted display face through `next/font`. The overlay keeps its
own explicit system stack, for the reason above.

## Spacing and radius

Spacing `4 / 8 / 16 / 24 / 32 / 48 / 64`. Radius `6 / 10 / 14 / full`.

These **replace** the scales that were in `apps/mobile/src/ui/theme.ts`, which
shipped radii `4 / 8 / 16` and type `12 / 14 / 16 / 18 / 22 / 28 / 36`. Those
disagree with these at nearly every step. They were scaffolding — the file marks
them as being for upcoming screens and no screen reads them — so the shared
scale wins. Only the `64` spacing step is carried over from it.

## Component states

Every interactive element defines all five, and none of them may be the only
signal:

- **default** — `surfaceRaised` fill or a `borderControl` outline
- **hover** — one step up the neutral scale, or `accentHover` on an accent fill
- **active** — the accent fill, or the accent as a left rule on a selected row
- **disabled** — reduced opacity **and** a removed border, so it does not read as
  merely dim on a dark background
- **focus-visible** — a 2px `accentText` ring, offset 2px

Focus-visible is mandatory in the overlay specifically, and is worth stating
separately: it sits on a page whose own styles guarantee nothing, so a control
that relies on the host page's focus treatment has none.

## Motion

Minimal, and never in the way of reading a translation. The level meter that
already animates, a status colour crossfade, an entrance for a newly settled
transcript line, and the capture indicator's pulse. Everything behind
`prefers-reduced-motion: reduce`.
