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

`textSecondary` and `borderStrong` reached the extension but **never reached web**:
they existed in `packages/ui/src/tokens.ts` and appeared in neither
`apps/web/app/globals.css` nor `token-parity.spec.ts`'s table, so every test passed
over their absence. The consequence was visible rather than theoretical — with only
`text` (16.83) and `textMuted` (5.92) available, every non-heading string on web had
to shout or look disabled while the extension rendered the middle step in three
places. That is why web read flatter than the extension, and it was plumbing, not
taste. The spec now asserts the other direction too (`maps every colour token`), so a
token added to the module and forgotten here fails a test instead of drifting. On web
these two carry the CSS names `--prose` and `--border-strong` — see § Type for why
`--text-secondary` is not available as a name.

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

Two current gaps, both real: `apps/web/src/components/translate/audio-source-controls.tsx:86`
transitions a width with no `motion-reduce:`, and
`apps/web/app/translate/baseline/page.tsx:63` spins a `Loader2` with none either. The
identical meters in `cascade-panel.tsx:123` and `live-panel.tsx:126` do carry it, and
`status-indicator.tsx:49`'s `animate-ping` is covered at `:54`. A grep for
`transition-\[` alone will not find the second gap — use `animate-|transition-`.

## Copy register

What the product may say out loud. The rule: **name the wait, the outcome, or the
next step — never the pipeline.** `apps/extension/entrypoints/popup/main.ts:110-120`
already holds the exemplar and records why:

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
| `Cascade — a turn at a time`                                                                            | `extension/entrypoints/popup/index.html:82`          | **Delete** — `#mode` leaves the popup                                                                         |
| `Live — speaks while you talk`                                                                          | `index.html:83`                                      | **Delete** — same                                                                                             |
| `Report timings for measurement`                                                                        | `index.html:137`                                     | **Delete** — not in the production build                                                                      |

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
