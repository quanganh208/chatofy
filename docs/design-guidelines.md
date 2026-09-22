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
Web, the popup and mobile all offer the three; **the overlay does not, and that is the
one exception worth understanding.**

The overlay renders on top of someone else's video, and inside a content script
`prefers-color-scheme` answers for the operating system rather than for the page it is
standing on. Following it would drop a white panel onto a dark call. So the overlay is
permanently dark, and it reads the dark palette (`color`) directly.

The accent appears **once per screen-state**. Hierarchy is carried by size, weight and
space; the ink fill is reserved for the single action a surface exists to offer, and
the state colours for the states that mean something. Both rules are gated — see
[State inventory](#state-inventory) and the accent-budget specs.

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

| Token           | Light     | Dark      | Where                                                   |
| --------------- | --------- | --------- | ------------------------------------------------------- |
| `bg`            | `#F5F5F4` | `#0C0A09` | the page itself — stone, and night                      |
| `surface`       | `#FFFFFF` | `#1C1917` | cards and panels                                        |
| `surfaceRaised` | `#EDEBE9` | `#252220` | a well (field, track) or a control resting on a surface |

Light `surfaceRaised` is **darker** than `bg` on purpose: the C1 wells — a field, the
segmented track, the slider track — are cut into the page, not lifted off it. In dark,
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
light and 3.49 dark, clearing WCAG 1.4.11's 3:1. Under direction C1 it is no longer the
edge of every control — see [Control depth](#control-depth) — but where a real boundary
is still required it holds.

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

`--text-display` is the landing hero and nothing else, and it is **web-only**: the popup
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

**Half-closed, deliberately.** The mechanism is in place and asserted; the call
sites are not swept yet. Until they are, web still holds 32 Tailwind size utilities
and 3 `text-[Npx]` literals. Sweeping them is its own change, for the reason this
section always gave.

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
look drawn for their size, plus italic for the hero's "Be heard". Self-hosted through
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
It measures 1.34:1 against the page, which makes it a hairline rather than a boundary,
so 1.4.11 does not reach it. `borderControl` is a different token and a real boundary —
see [What the measurements say](#what-the-measurements-say).

The scale is now actually exercised, which it was not when these values were released:
cards at `md` (`card.tsx` carries `shadow-elev-md` on the base), the popover and the
avatar dropdown at `lg`, controls and the selected segment at `sm`. That is most of what
makes the current surfaces read as finished, and it cost no token change.

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

These **replace** the scales that were in `apps/mobile/src/ui/theme.ts`, which
shipped radii `4 / 8 / 16` and type `12 / 14 / 16 / 18 / 22 / 28 / 36`. Those
disagree with these at nearly every step. They were scaffolding — the file marks
them as being for upcoming screens and no screen reads them — so the shared
scale wins. Only the `64` spacing step is carried over from it.

## Control depth

**A field is a well cut into the surface. A button is an object sitting on it.**

That opposition — the direction of depth — is how the two are told apart, and it
is the whole of the rule:

|        | Field (`Input`, `SelectTrigger`) | Quiet button (`Button variant="outline"`) |
| ------ | -------------------------------- | ----------------------------------------- |
| Shape  | `--inset-field`, inset           | `--elevation-sm`, cast outward            |
| Edge   | the inset shadow's second layer  | `--surface-hairline` as an inset ring     |
| Hover  | fill deepens, **nothing moves**  | lifts 1px to `--elevation-md`, fill steps |
| Active | nothing                          | presses 1px, back to `--elevation-sm`     |
| Border | none                             | none                                      |

Fill cannot carry the distinction and must not be asked to: `card` and
`secondary` are 1.10:1 apart, a difference nobody sees. Movement is the button's
signal and stillness is the field's.

Both must survive reduced motion. Suppressing the transition is not enough — that
removes the easing and leaves a harder snap than before. The **transform itself**
is zeroed per state, and the button keeps a fill step so a reader who asked for
stillness still gets hover feedback. Dark's elevation is a single near-invisible
layer, so on that theme the fill step is doing most of the work.

### What C1 gives up, and why it was accepted anyway

The edge a control ends up with under this rule composites to **1.13:1** in light
and **1.17:1** in dark. WCAG **1.4.11** asks 3:1 for the visual boundary of a user
interface component at rest. This does not meet it, knowingly.

The alternative was on the table and measured. Variant **C2** kept a real
`borderControl` boundary on the field and cleared the floor; it was shown
side by side with these numbers and **C1 was chosen deliberately**. This section
exists so that a later accessibility audit can disagree on the merits rather than
assume an oversight.

Two facts bound the cost, and neither is a rationalisation after the fact:

- **The focus ring is untouched.** `--ring`, drawn at the 50% it renders at, measures
  **3.21:1** at worst (light, on `surfaceRaised`) across every ground a control sits on — `card`, `background`, `surfaceRaised`,
  `warningSubtle`, `liveSubtle` — in both themes. 1.4.11's state-indication half
  is satisfied **for that ring**; only the at-rest boundary was traded.

  One control state falls outside it, and outside the spec that measures it. A control
  that is `aria-invalid` REPLACES the ring rather than adding to it —
  `aria-invalid:focus-visible:ring-destructive/50`, in `input`, `select`, `textarea`,
  `checkbox`, `radio-group`, `toggle`, `badge` and `button`. A ring is one box-shadow
  slot, so on an invalid AND focused control that is the only state indicator drawn,
  and it measures **2.18–2.45:1** — under the floor. The state predates this direction
  and the repalette did not move it: the destructive hexes are unchanged. Closing it
  means raising the alpha or moving `live`, which is a palette decision nobody has
  taken yet, so it is recorded here and in `contrast-floors.spec.ts` rather than
  asserted green.

- **No softer token could have cleared it.** `borderStrong` measures 2.52/2.29
  and `border` 1.39/1.23 on a card. Reaching 3:1 means `borderControl` or nothing, so this
  was a choice between the C1 language and an outline, not a value to tune.

### Where a real boundary is still required

`borderControl` is scoped, not retired. Use it where a boundary must be found
without hovering:

- **A control inside a filled notice.** `Alert`'s `live` and `warning` variants
  re-border their actions in the notice's own hue, at their own width. This is a
  **recorded exception to C1** and `skin-guard.spec.ts` holds both halves of it.
  The alternative — moving the hue to the fill — was rejected on measurement: the
  notice's ink on its own hue is 1.90:1 (dark `warning`), 2.58:1 (light) and
  2.88:1 on `live`, which fails 1.4.3's 4.5:1 for the LABEL of the button that
  opens the user's microphone.
- **A checkbox or radio**, whose shape _is_ its edge — there is no room for a
  recess in 16px.
- **An invalid field or button**, where `aria-invalid` draws a 1px `destructive`
  ring. Invalid is an escalation, and escalation is what this token is for.

## Component states

Every interactive element defines all six, and none of them may be the only
signal:

- **default** — the depth pair above: inset for a field, elevation for a button.
  An `accent` fill for the one primary action on a screen
- **hover** — one step up the neutral scale, or `accentHover` on an accent fill.
  A button also lifts; a field does not
- **active** — a button presses; an accent fill, or the accent as a left rule on
  a selected row
- **disabled** — reduced opacity **and** the depth removed, so it does not read as
  merely dim on a dark background
- **focus-visible** — a 3px `ring` at 50%, composed _over_ whatever depth the
  control already has rather than replacing it
- **invalid** — driven by `aria-invalid`, so the visual state and the announced
  state cannot drift apart

The focus rule is the shipped one, and this document used to disagree with every
component about it: it prescribed "a 2px `accentText` ring, offset 2px" while
seven primitives shipped `ring-[3px] ring-ring/50` and only the app shell followed the
document — a component since deleted, its work split across `app-chrome.tsx`,
`marketing-header.tsx` and `plain-frame.tsx`. The contradiction predates direction C1 and is settled here
in favour of what ships — `--ring` is now carrying more of the identification
load than it used to, and one rule is worth more than the better of two.

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
  `Separator`, `Sheet`, `Sidebar`, `Skeleton`, `Slider`, `Switch`, `Tabs`, `Toggle`,
  `ToggleGroup`, `Tooltip`. Generated by the shadcn CLI, then re-skinned. They carry no
  product vocabulary: a primitive that knows what a meeting is has been written in the
  wrong place.
- **Compositions** — `DirectionToggle` (on `Button`), `SegmentedControl` and
  `ThemeToggle` (on `ToggleGroup`), `StatusIndicator` (on `Badge`). This product's
  own, and they live here for one reason only: **both DOM surfaces render them.** Not
  "it seems reusable" — two real consumers, today. A composition with one consumer
  belongs in the app that consumes it.

  Two of them take a `labels` prop defaulting to English: `ThemeToggle` and, since the
  Vietnamese locale landed, `DirectionToggle`. That is the arrangement a composition in
  this package must use when it says words — the popup renders it and has no dictionary,
  so it keeps working unchanged, while web passes the reader's words down. A composition
  that reached for a translation itself would have to know which of two surfaces it was
  on, which is exactly what living here means it cannot know.

`Tabs` ships with **no consumer**, deliberately, so the shape exists when a surface
finally switches between panels of content. Nothing does today: the three translate
routes are routes, which is the right answer for something that should have a
shareable URL and answer to the back button. It is emphatically not what the segmented
controls are built on — they set a value and reveal no panel, and Tabs without a
tabpanel announces "tab, 1 of 2" to a reader who then looks for content that does not
exist.

`Select` has **no consumer either**, and arrived there by the opposite route: it had
one until the voice control was merged onto `SegmentedControl` (see _No longer
duplicated_ below). It is kept because a dropdown is still the right shape for a
choice among many named things, and nothing on either surface offers one today.

Its trigger **follows the field**, not the button: recessed, 40px, no border.
Decided rather than left alone. A consumer-less component still speaking the
pre-C1 language would hand its first consumer a control matching nothing on the
screen it lands in — and a select shows a chosen value, which is what a field
does, and will stand in a form column beside `Input`. The chevron already says it
opens.

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

`Input` was briefly a third, between the phase that added it and the phase that
adopted it. It has consumers on both surfaces now — both sign-in forms — and is
listed above rather than here.

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
sheet would make a permanently-dark surface follow the operating system. No test
catches that one, so it is a rule for the person writing it.

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
are now banned** by `packages/ui/src/react/skin-guard.spec.ts` and its app-side sibling.
The `hover:bg-primary/90` row used to be described here as a review rule with no test;
that is no longer true. It became the `bg-primary/\d` pattern in both guards, and adding
it caught a violation that had been shipping in `badge.tsx` — which is the argument for
turning a review rule into a spec whenever the rule can be written as one.

The full `FORBIDDEN` list is `dark:`, `bg-accent`, `text-accent-foreground`,
`bg-popover` / `text-popover-foreground`, `border-input`, `text-sm` / `text-xs`,
`bg-primary/\d`, and the `@/lib/utils` alias.

The same spec also holds two rules that are the opposite shape — things a component
must **carry**, which a ban cannot express:

- a filled `Alert` re-borders its actions in the notice's own hue
  (`[&_[data-slot=button]]:border-live` / `border-warning`). A control on
  `warningSubtle` / `liveSubtle` puts `borderControl` at 2.95, 2.87 and 2.70:1,
  under 1.4.11's floor; `apps/web/src/design/contrast-floors.spec.ts` cannot catch
  it, because it measures token pairs rather than which token a component asks for
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
menu, and the popup already renders `DirectionToggle` directly above it with the
same uppercase label and the same segmented shape.

The e2e suite is what makes this safe to change: it asserts the popup does not
scroll sideways at 320px across every state, and that Start stays above the 600px
cap. Both still pass.

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

| Current string                                                                                          | `file:line`                                          | Decision                                                                               |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `Cascade`                                                                                               | `web/src/components/translate/mode-toggle.tsx:23`    | **Delete** — file removed; the mode choice leaves the product surface                  |
| `Live`                                                                                                  | `mode-toggle.tsx:32`                                 | **Delete** — same                                                                      |
| `Turn-based baseline`                                                                                   | `web/app/translate/page.tsx:75`                      | Done — renamed to an experience name, then removed outright when the route was deleted |
| `heard during playback: {n}`                                                                            | `web/src/components/translate/cascade-panel.tsx:145` | **Delete from the product surface** — a diagnostic counter                             |
| barge-in / echo tooltip                                                                                 | `cascade-panel.tsx:143`                              | **Delete** with the counter it explains                                                |
| `End-to-end speech translation. Unlike the cascade, this does not wait for you to finish a sentence…`   | `live-panel.tsx` (deleted)                           | Done — the panel and its route are gone, and the string with them                      |
| `The translation trails you by about three and a half seconds — that is the model, not the connection.` | `live-panel.tsx` (deleted)                           | Done — same                                                                            |
| `Heard {vi}, but this direction expects {en}`                                                           | `live-panel.tsx` (deleted)                           | Done — same; the language-code rule below outlives it                                  |
| `Cascade — a turn at a time`                                                                            | removed with `#mode`                                 | Done — the selector and both its options left the popup                                |
| `Live — speaks while you talk`                                                                          | removed with `#mode`                                 | Done — same                                                                            |
| `Report timings for measurement`                                                                        | removed with `#metrics`                              | Done — the checkbox is gone; the `reportMetrics` flag and its code path are kept       |

**Language codes are never user-facing.** The surface that made this concrete — a live
panel naming the language it heard against the one the direction expected — is deleted,
and the rule is not. Codes still enter the app as data: a direction is `vi_to_en`, and
`makeLanguageName` (`web/src/i18n/direction-labels.ts`) is the one place a code becomes a
word. It needs a defined fallback, because a grep-clean dictionary can still render `xh`
at runtime from a value the model chose.

**Exempt, with reasons.** Safety text keeps its meaning even when its register
changes: the recording disclosure (`popup/index.html:29-41`), and the overlay's
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
`languageName()` in `@chatofy/ui` pins Vietnamese and English to their ENGLISH names,
which is right for a package with no locale and wrong on a Vietnamese page — so web
supplies its own through `apps/web/src/i18n/direction-labels.ts`, falling back to the
helper for a code neither locale pins.

**The register of address is neutral "bạn"**, everywhere, decided 2026-08-25. Not "quý
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

> **This table's `file:line` refs are stale and were already stale before the
> elevation work.** They point at `main.ts` and `styles.ts`, which the React popup
> rewrite replaced with `popup.tsx`, `use-popup.ts`, `settings-pane.tsx` and
> `consent-gate.ts`. The STATES are still right and still the thing this table is
> for — a surface that looks unfinished because nobody drew its empty or error
> case is what it catches. Only the addresses rotted. Re-deriving them is its own
> change and is deliberately not folded into a depth-and-motion pass.

| State                           | Renders at                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| consent unseen                  | `main.ts:273-277` `showConsent(true)` — hides chrome, settings **and** footer, so Start is not on screen at all           |
| consent just dismissed          | `main.ts:403` + `:402-408` re-runs `refreshScrollFade()`. **This** is the state where Start once fell below the 600px cap |
| meeting tab, idle               | `main.ts:222` `toggle.disabled` false, footer visible                                                                     |
| meeting tab, capturing          | `main.ts:222`; header state pill `styles.ts` `.state.live` (pulses)                                                       |
| non-meeting tab                 | `main.ts:199-201` `unsupported.hidden = false`, message from `supportOf`                                                  |
| Zoom-desktop tab                | same site, `support.kind === 'action'` → `:200` adds `.action`                                                            |
| microphone notice               | `main.ts:99-101` — only when outbound is on and permission is not granted                                                 |
| Start disabled by `Runs on` off | `main.ts:175` `input.disabled`, `:222`                                                                                    |
| `main.scrolls` on / off         | `main.ts:269` — measured from `scrollHeight > clientHeight`, so any content-height change moves it                        |

**Overlay** (`extension/entrypoints/content/`)

| State                                       | Renders at                                                                                                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pill, idle                                  | `overlay.ts:125-128`; part chosen by `visibleOverlayPart` (`src/site-enablement.ts`)                                                                                                               |
| pill, live                                  | `.pill.live` — pulses; the undismissable capture signal when collapsed                                                                                                                             |
| panel, idle, empty                          | `overlay.ts:140` `.panel` + empty `.lines`                                                                                                                                                         |
| panel, capturing, empty                     | same, indicator visible                                                                                                                                                                            |
| panel with turns, incl. `.mine` and `.live` | `overlay.ts` `renderLines` (text nodes only)                                                                                                                                                       |
| error bar — capture / inbound / outbound    | `overlay.ts:107` `errors: {}`; `renderErrors` renders **one line per failing direction**, deliberately: one line cannot say the meeting translates fine while nothing the user says reaches anyone |
| outbound `sending`                          | `overlay.ts:52`                                                                                                                                                                                    |
| outbound `muted`                            | `overlay.ts:53-55`                                                                                                                                                                                 |
| outbound `patched: false`                   | `overlay.ts:57-60` — the two-step reload instruction                                                                                                                                               |

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
| landing, mobile nav closed / open          | `layout/marketing-menu.tsx:35` — the sheet; the desktop nav is hidden below `md`                                                                                                                              |
| `/translate` mic refused                   | `translate/readiness-banner.tsx` `microphoneFault` — the banner speaks, otherwise silent                                                                                                                      |
| `/translate` mic not asked / unknown       | same function — and neither is a fault, so neither renders anything                                                                                                                                           |
| `/translate` mic absent                    | same function — no `audioinput` device; a refused permission still wins over it                                                                                                                               |
| `/translate` service reachable             | nothing renders; a probe still in flight is not a problem to report                                                                                                                                           |
| `/translate` service unreachable           | `translate/readiness-banner.tsx` — a failed `GET /health`, and a hung one after 5s                                                                                                                            |
| sidebar expanded / rail                    | `layout/app-chrome.tsx:51` `opensExpanded` — the route decides, not a cookie                                                                                                                                  |
| sidebar mobile sheet                       | `packages/ui/src/react/sidebar.tsx:171` — the primitive swaps to a `Sheet` below `md`                                                                                                                         |
| session menu loading                       | `layout/session-menu.tsx` — a `Skeleton` at the avatar's size, never `null`                                                                                                                                   |
| `/translate` idle                          | `translate/cascade-panel.tsx:52` `STATUS_KEY.idle`                                                                                                                                                            |
| connecting                                 | `STATUS_KEY.connecting`                                                                                                                                                                                       |
| listening / hearing speech                 | `STATUS_KEY.listening`, `'hearing-speech'`                                                                                                                                                                    |
| translating                                | `STATUS_KEY.translating`                                                                                                                                                                                      |
| playing                                    | `STATUS_KEY.playing`                                                                                                                                                                                          |
| display popover closed / open              | `translate/display-settings-popover.tsx` — the gear at the end of the dock; non-modal, so the transcript stays readable                                                                                       |
| voice popover closed / open                | `translate/voice-settings-popover.tsx` — the speaker in the panel header, glyph swapped on `voiceOutput`; also non-modal                                                                                      |
| `/translate` panel headers, idle / running | `translate/panel-headers.tsx` — the direction, named permanently; the swap goes dead mid-conversation                                                                                                         |
| voice popover open mid-conversation        | `translate/voice-settings-panel.tsx:87` `disabled={running}` — everything but volume is frozen; direction with it, at `translate/panel-headers.tsx:181`                                                       |
| transcript empty                           | `translate/conversation-transcript.tsx:66` — copy differs on `running`                                                                                                                                        |
| running with turns                         | same component, the turn list                                                                                                                                                                                 |
| error notice                               | `translate/cascade-panel.tsx:148` (`role="alert"`)                                                                                                                                                            |
| `/preferences` defaults section            | `preferences/conversation-defaults-section.tsx` — the same panel, `running={false}`, and the screen's one elevated surface                                                                                    |
| `/preferences` interface section           | `preferences/interface-preferences-section.tsx` — language and theme, on the page ground                                                                                                                      |
| `/account` identity loading                | `account/account-identity.tsx` — the header paints at once; only the join date holds a place                                                                                                                  |
| `/account` identity loaded                 | same component; name and email paint from the session before the profile lands                                                                                                                                |
| `/account` profile lookup failed           | `account/account-screen.tsx` — reported on the join-date line, and nobody is signed out for it                                                                                                                |
| any route, error boundary                  | `app/(app)/error.tsx`, `app/(auth)/error.tsx`, `app/(marketing)/error.tsx`                                                                                                                                    |
| any address that is not a route            | `app/not-found.tsx`                                                                                                                                                                                           |

Not reachable without a backend or a forced value: `live.error`,
`languageMismatch`, `connecting`, `translating`, and the readiness card's
`unreachable`. There is no Playwright in
`apps/web` and none is being added, so those are reviewed against a temporarily
forced value — stated here so a screenshot set is not mistaken for a harness.
