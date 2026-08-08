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

| Token          | Value     | Contrast         | Where                                                                 |
| -------------- | --------- | ---------------- | --------------------------------------------------------------------- |
| `accent`       | `#6E56CF` | 3.62 on `bg`     | **fills only** — primary buttons, the selected segment, a level meter |
| `accentHover`  | `#7A5FD6` | white on it 4.73 | hover state of the above                                              |
| `accentText`   | `#9B87F5` | 6.68 on `bg`     | accented **text** — links, a speaker label                            |
| `accentSubtle` | `#2A2250` | —                | background of a selected chip or a mode notice                        |
| `onAccent`     | `#FFFFFF` | 5.39 on `accent` | text sitting on an accent fill                                        |

The split is the important part. `accent` at 3.62 fails AA for body text — it
clears the 3:1 a non-text component needs and nothing more. Using one indigo for
both a button fill and a link is how a palette ends up inaccessible while
looking deliberate, so the text variant is a separate token and the fill variant
must never be used for a sentence.

`accentHover` is measured against **white**, not against the background, because
that is where it is used: under the label of a button someone is about to press.
The obvious next step up the ramp — `#7C66DC` — reads better against `bg` and
puts white text at 4.38, so a button would pass at rest and fail on hover. A
hover state is not a place to lose contrast.

### State

This product has states a generic palette has no name for, and each gets exactly
one colour used the same way on every surface.

| Token           | Value     | Means                                                                                                                   |
| --------------- | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| `live`          | `#E5484D` | capture is running; also the stop action. 4.99 on `bg` as text or a dot                                                 |
| `liveFill`      | `#D13438` | anything with white text ON it — the capture indicator bar, the Stop button. 4.93; `live` itself would be 3.91 and fail |
| `liveSubtle`    | `#3B1219` | background of a live-state notice                                                                                       |
| `speaking`      | `#30A46C` | a translation is playing. 6.19 as text; dark text on it as a fill is also 6.19                                          |
| `warning`       | `#FFB224` | the user has something left to do — grant the microphone, reload the page                                               |
| `warningSubtle` | `#3B2400` | background of a warning notice                                                                                          |

**`live` and `speaking` must never be distinguished by colour alone.** They are
red and green, adjacent, and often rendered as a status dot — the textbook
red-green failure. Every place they appear carries a text label as well, and the
two differ in behaviour: `live` pulses, `speaking` does not. A reviewer who
suggests the label is now redundant because there is a colour is wrong, and this
sentence exists so that is a one-line answer.

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
