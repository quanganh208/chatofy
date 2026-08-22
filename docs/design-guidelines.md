# Design guidelines

What the product looks like, and why each value is the value it is. The tokens
themselves live in `packages/ui/src/tokens.ts` and are consumed by web, the
extension and mobile; this document is where the reasoning is kept, because a
hex in a TypeScript file cannot say what it is for.

## Direction: two grounds, one restrained accent

The theme is the reader's choice — light, dark, or whatever the machine asks for.
Web, the popup and mobile all offer the three; **the overlay does not, and that is the
one exception worth understanding.**

The overlay renders on top of someone else's video, and inside a content script
`prefers-color-scheme` answers for the operating system rather than for the page it is
standing on. Following it would drop a white panel onto a dark call. So the overlay is
permanently dark.

That constraint used to be applied to everything: if the overlay must be dark, the
reasoning went, a light web could never read as the same product, so web was dark too.
The constraint is real and the extension of it was not. Separating them is what made
two themes possible without the failure the original decision was guarding against.

The accent appears **once per screen**. Hierarchy is carried by size, weight and
space; colour is reserved for the single action a surface exists to offer, and for the
states that mean something. That is why the palette below looks thin — a second
accent-filled control is the thing this direction is built to prevent.

The rule was formally released when elevation arrived, and then not used. Depth
answered the complaint it was released for, and a permission is not an instruction.
Recorded so the next person finds a decision rather than an omission.

**Surfaces are separated by depth, not by rules.** This reverses the previous
direction, which held that "this direction separates surfaces with rules instead of
luminance steps". That was applied faithfully and rejected on sight: white cards on a
near-white ground, divided by hairlines, read as a line drawing rather than as a
product. The reversal was the owner's call after seeing both drawn side by side.

What the old direction was protecting is kept. The translation is still the largest
thing on a translate surface, elevation is a scale of three rather than a free
parameter, and no shadow competes with text for attention. See
[Elevation](#elevation).

Every value here is measured. `apps/web/src/design/contrast-floors.spec.ts` holds the
pairs and the floors and fails when one slips.

It used to be a script under `plans/`, cited from here and from `tokens.ts` as the
enforcement authority. It could not be one: `plans/` is a record of work rather than
part of the product, nothing ran the script, and a single `git rm` of the plan tree
took the cited authority with it — which is exactly what happened. The spec also reads
the palettes from `tokens.ts` instead of restating them, so a hex changed there is
measured here; the script carried its own copy and could only check what it had last
been told.

## Palette

Two values per token, one meaning. `color` in the token module is the **dark** half —
the overlay imports it directly and must never see the other. `colorLight` is the light
half, and `palettes` is the pair for the surfaces that let someone choose.

### Neutrals

| Token           | Light     | Dark      | Where                                                      |
| --------------- | --------- | --------- | ---------------------------------------------------------- |
| `bg`            | `#FCFCFB` | `#111214` | the page itself                                            |
| `surface`       | `#FFFFFF` | `#191B1E` | cards and panels                                           |
| `surfaceRaised` | `#F4F4F1` | `#212429` | something sitting on a surface — a control, a selected row |

### Borders

| Token           | Light     | Dark      | Where                             |
| --------------- | --------- | --------- | --------------------------------- |
| `border`        | `#E4E4E0` | `#292C31` | the hairline between two surfaces |
| `borderStrong`  | `#B5B5AB` | `#43484E` | an emphasised divider             |
| `borderControl` | `#8D8D85` | `#696E76` | the edge of a control             |

### Text

| Token           | Light     | Dark      | On light bg | On dark bg | Where                             |
| --------------- | --------- | --------- | ----------- | ---------- | --------------------------------- |
| `text`          | `#131313` | `#F0F0EE` | 18.10       | 16.43      | headings and the translation      |
| `textSecondary` | `#4A4A46` | `#B4B6B2` | 8.67        | 9.17       | supporting prose, the source line |
| `textMuted`     | `#6F6F6A` | `#8A8D8A` | 4.92        | 5.58       | hints and field labels            |

### Accent

| Token          | Light     | Dark      | Where                                       |
| -------------- | --------- | --------- | ------------------------------------------- |
| `accent`       | `#2F4CE0` | `#7A90F5` | the one filled action on a screen           |
| `accentHover`  | `#2439C4` | `#93A5F8` | that action, hovered                        |
| `accentText`   | `#2740CC` | `#A3B4F9` | the accent read as text, and the focus ring |
| `accentSubtle` | `#ECEFFD` | `#1B2140` | its own tint, behind accent text            |
| `onAccent`     | `#FFFFFF` | `#0B1030` | the label on the filled action              |

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

### Overlay-only

| Token            | Value                       | Why it is separate                                                                                 |
| ---------------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| `overlay.bg`     | `rgba(17, 17, 19, 0.94)`    | translucent, so a bright video frame still reads through the panel rather than being blocked by it |
| `overlay.border` | `rgba(255, 255, 255, 0.12)` | the panel's edge against arbitrary video behind it                                                 |

One value each, deliberately. These belong to the surface that has no second ground.

### What the measurements say

Body text reads **18.10:1** on the light ground and
**16.43:1** on the dark one. Supporting prose —
`textSecondary`, the step whose absence once made web read flatter than the extension —
reads 8.67 and
9.17. The quietest tier, `textMuted`, still clears
4.5 at 4.92 and 5.58.

`borderControl` is solved against `surfaceRaised` rather than `surface`, because that is
the ground a control actually sits on and it is the tighter of the two: it reads
3.03 and
3.03, both clearing WCAG 1.4.11's 3:1
for the visual boundary of a user interface component. **It does not recede under the
elevation direction.** Surfaces separate by shadow now, but a control's own boundary is
not a surface separation, and 1.4.11 still reaches it — this is the one border that a
depth pass must leave alone.

`borderStrong` is a divider and not a boundary, so 1.4.11 does not reach it. It carried
a floor of 2.01 and 2.03 because
the old direction made an invisible rule cost the whole separation mechanism. Shadow
does that work now, and the hairline is free to recede to `surfaceEdge.hairline` on an
elevated surface. The floor stays anyway: nothing has replaced what it measures on the
surfaces still drawn with a border, and lowering a floor is a decision rather than a
consequence of one.

**The accent-versus-speaking problem is fixed rather than tolerated.** This document used
to record that `speaking` against the old cyan accent was "green against cyan rather than
green against purple", tolerable only because the labelling rule held everywhere. Measured,
that gap was 40.1°. It is now
79.5° on light and
80.8° on dark. The labelling rule still holds — it
just is not the only thing holding.

`destructive` keeps its own name although it carries the same value as `live`. They mean
different things, and merging them would turn a future divergence into a rename.

## Type

Web reaches these steps through **role-named** custom properties in `@theme`, not
through the token key names:

| Property             | Step   | Size |
| -------------------- | ------ | ---- |
| `--text-label`       | `xs`   | 11   |
| `--text-hint`        | `sm`   | 12   |
| `--text-body`        | `base` | 14   |
| `--text-translation` | `md`   | 17   |
| `--text-heading`     | `lg`   | 22   |
| `--text-title`       | `xl`   | 28   |

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

Web uses a self-hosted display face through `next/font`. The overlay keeps its
own explicit system stack, for the reason above.

**The popup keeps the system stack too, and is deliberately not unified with
web.** The overlay cannot take a bundled face — it renders inside someone else's
page and every byte is injected there — so unifying the popup with web would not
give the product one typeface, it would give the extension two. Between matching
the other extension surface and matching the website, the popup is a 320px panel
hanging off the browser's own toolbar; reading as part of the browser is the more
useful of the two. Recorded here because it is a real divergence between surfaces
rather than an oversight, and the next person to notice it should find the reason
instead of the bug.

## Elevation

Three steps, each carrying both themes, and the two halves are **not the same shape**.

| Step | Light                               | Dark                                  | Where                                                     |
| ---- | ----------------------------------- | ------------------------------------- | --------------------------------------------------------- |
| `sm` | two tight layers at 5.5% and 4% ink | one anchor at 35% black               | a control, a selected segment — lifted just off its track |
| `md` | 5% at 4px plus 7.5% at 16px         | 42% at 14px, plus the inset highlight | a card or panel: the resting height of a surface          |
| `lg` | 5% at 8px plus 10% at 34px          | 50% at 30px, plus the inset highlight | something over the page — a dropdown, the overlay's panel |

**Dark does not use shadow for depth, because it cannot.** Black on `#111214` is very
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

## Where a component lives

`@chatofy/ui/react` is rendered by `apps/web` and by the extension's **popup**.
It is not rendered by the extension's **overlay**, which draws itself from a
hand-written string into a closed shadow root, and it is unreachable from
`apps/mobile`, which is React Native and imports only the root token entry.

**Everything web and the popup render is shadcn, or is composed only from shadcn.**
Nothing hand-rolls its own structure any more.

Two kinds of thing live behind that subpath, and the difference decides who may
change one:

- **Primitives** — `Alert`, `Badge`, `Button`, `Card`, `Checkbox`, `Label`,
  `RadioGroup`, `Select`, `Separator`, `Tabs`, `Toggle`, `ToggleGroup`. Generated by
  the shadcn CLI, then re-skinned. They carry no product vocabulary: a primitive that
  knows what a meeting is has been written in the wrong place.
- **Compositions** — `DirectionToggle` (on `Button`), `SegmentedControl` and
  `ThemeToggle` (on `ToggleGroup`), `StatusIndicator` (on `Badge`). This product's
  own, and they live here for one reason only: **both DOM surfaces render them.** Not
  "it seems reusable" — two real consumers, today. A composition with one consumer
  belongs in the app that consumes it.

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

Neither is reported by `knip`, and not because of an exception: both are exports of
the `./react` entry point, and knip treats a package's declared public surface as
used. So nothing mechanical will notice a third consumer-less primitive appearing —
this paragraph is the only record, and it has to be updated by hand.

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

The CLI writes stock shadcn. Four things in its output are wrong here. Three of them
are banned by `packages/ui/src/react/skin-guard.spec.ts`; the `hover:bg-primary/90`
row is a review rule and has no test, so do not cite the spec for it. The full
`FORBIDDEN` list is `dark:`, `bg-accent`, `text-accent-foreground`, `bg-popover` /
`text-popover-foreground`, `border-input`, `text-sm` / `text-xs`, and the
`@/lib/utils` alias.

| Stock shadcn                          | This project                           | Why                                                                                                                                                          |
| ------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hover:bg-primary/90`                 | `hover:bg-accent-hover`                | fading a filled button on a dark ground reads as disabled, not as hovered                                                                                    |
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

| Current string                                                                                          | `file:line`                                          | Decision                                                                                                      |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `Cascade`                                                                                               | `web/src/components/translate/mode-toggle.tsx:23`    | **Delete** — file removed; the mode choice leaves the product surface                                         |
| `Live`                                                                                                  | `mode-toggle.tsx:32`                                 | **Delete** — same                                                                                             |
| `Turn-based baseline`                                                                                   | `web/app/translate/page.tsx:75`                      | **Rename** — names a measurement method. Becomes an experience name (route stays, it is the latency baseline) |
| `heard during playback: {n}`                                                                            | `web/src/components/translate/cascade-panel.tsx:145` | **Delete from the product surface** — a diagnostic counter                                                    |
| barge-in / echo tooltip                                                                                 | `cascade-panel.tsx:143`                              | **Delete** with the counter it explains                                                                       |
| `End-to-end speech translation. Unlike the cascade, this does not wait for you to finish a sentence…`   | `web/src/components/translate/live-panel.tsx:86-88`  | **Rewrite** — explains mechanism and compares to a backend the reader cannot see                              |
| `The translation trails you by about three and a half seconds — that is the model, not the connection.` | `live-panel.tsx:181-182`                             | **Rewrite** — keep the wait, drop the architecture defence                                                    |
| `Heard {vi}, but this direction expects {en}`                                                           | `live-panel.tsx:147-149`                             | **Rewrite** — see the language-code rule below                                                                |
| `Cascade — a turn at a time`                                                                            | removed with `#mode`                                 | Done — the selector and both its options left the popup                                                       |
| `Live — speaks while you talk`                                                                          | removed with `#mode`                                 | Done — same                                                                                                   |
| `Report timings for measurement`                                                                        | removed with `#metrics`                              | Done — the checkbox is gone; the `reportMetrics` flag and its code path are kept                              |

**Language codes are never user-facing.** `live-panel.tsx:35-38`'s `EXPECTED_SOURCE`
is the greppable half and maps to `'vi'`/`'en'`. The other half is not:
`live.detectedLanguage` (`use-live-translate.ts:32`, `string | null`) is whatever the
model returns, so a code→name table needs a defined fallback for a code it does not
know. A grep-clean surface can still render `xh` at runtime.

**Exempt, with reasons.** Safety text keeps its meaning even when its register
changes: the recording disclosure (`popup/index.html:29-41`), and the overlay's
reload-recovery instruction, which is two steps because reloading discards the
`activeTab` grant `tabCapture` needs — saying only "reload" walks the reader into a
trap. Shorten either at your peril; a reviewer who cannot restate the consequence
after reading the new copy has found the line that must not change.

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

| State                      | Renders at                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `/`                        | `app/page.tsx` — 8 lines, unstyled, no link onward. The gap this work closes              |
| `/translate` idle          | `cascade-panel.tsx:36-43` `STATUS_LABEL.idle`                                             |
| connecting                 | `STATUS_LABEL.connecting`                                                                 |
| listening / hearing speech | `STATUS_LABEL.listening`, `'hearing-speech'`                                              |
| translating                | `STATUS_LABEL.translating`                                                                |
| playing                    | `STATUS_LABEL.playing`                                                                    |
| transcript empty           | `conversation-transcript.tsx:41-47` — copy differs on `running`                           |
| running with turns         | `conversation-transcript.tsx:63`                                                          |
| error notice               | `cascade-panel.tsx:150-157` (`role="alert"`)                                              |
| baseline idle              | `app/translate/baseline/page.tsx:62-64`                                                   |
| baseline loading           | `:63-64` — `Translating… {elapsed}s`                                                      |
| baseline mic error         | `:67-69` — a coloured paragraph with **no** `role`; the notice consolidation gives it one |
| baseline turn error        | `:70-72` — same                                                                           |
| baseline result            | `:76` `ResultCard`                                                                        |

Not reachable without a backend or a forced value: `live.error`,
`languageMismatch`, `connecting`, `translating`. There is no Playwright in
`apps/web` and none is being added, so those are reviewed against a temporarily
forced value — stated here so a screenshot set is not mistaken for a harness.
