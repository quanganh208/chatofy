---
title: 'Phase 9: Marketing landing'
status: done
priority: P1
dependencies: [8]
---

# Phase 9: Marketing landing

## Overview

Replace the lean entry page at `/` with a full marketing landing. This is where "đẹp
hơn" is actually won — the app surfaces are already disciplined.

## Requirements

- [x] `/` is public and renders under the marketing chrome
- [x] Four to five sections, ending in a CTA
- [x] Every claim is true and traceable to the repo
- [x] Exactly one accent-filled control per viewport

## Architecture

### Sections

1. **Hero** — `--text-display` headline, one accent CTA plus a ghost secondary, and a
   visual that is a real `Card` at elevation `md` showing a two-turn conversation. The
   translation renders at `--text-translation` over the source at `--text-body`, which
   is the same hierarchy the transcript uses. Not a screenshot.
2. **How it works** — three outcome-register facts. Not pipeline stages.
3. **Runs on your machine** — the differentiator, and the reason someone grants a
   microphone. Three hops: on device → over the network → on device.
4. **Where Chatofy runs** — web, extension for meetings, mobile.
5. **Footer CTA** + a slim footer.

Cut: pricing, testimonials, logo walls, invented statistics.

### Copy register

The register is a content rule and it governs here hardest, because marketing copy is
where "name the wait, the outcome, or the next step — never the pipeline" dies first.

- "Không có nút dừng — lượt nói kết thúc khi bạn ngừng nói" is drawn from
  `cascade-panel.tsx`'s own docblock. That is the model.
- **"Recognise, translate, speak" and every variant of it is banned copy.** So are
  backend names and measurement-instrument names.
- The only honest numbers available are the measured latency figures already in
  `docs/development-journey.md`. If a number is not from there, it does not go on the
  page.
- Language codes never reach the screen.

### Elevation, used

The three-step elevation scale exists, dark's luminance-step mechanism is built, and
the shipped surfaces barely exploit it. Cards at `md`, dropdowns at `lg`, controls at
`sm`. This is free depth with zero token change and it is most of what makes the page
read as finished.

### Accent-once gets a partial mechanical gate here

"One accent-filled control per screen" is visual and has no full mechanical check. But a
partial one exists exactly where sprawl happens: **a render spec per marketing section
component asserting at most one element matching `[class*="bg-primary"]`.**

The section is the right unit. A page-level count would wrongly fail the legitimate
hero-CTA plus footer-CTA pair, while a section genuinely owns at most one filled control.
App screens stay a checklist item (Phase 12).

### Motion

Section entrances may use `duration.base`/`duration.slow` with `easing.enter`. Every one
carries a `motion-reduce:` escape. No parallax, no scroll-jacking, no continuous motion.

### Signed-in visitors

The marketing header's sign-in/CTA pair collapses to a single "Open Chatofy" pointing at
`/dashboard`. Read the session server-side in the layout. **Do not redirect `/` in
middleware** — the landing must stay shareable, and it doubles as the opening of the
thesis demo.

## Related Code Files

- Modify: `apps/web/app/(marketing)/page.tsx` — full rewrite
- Create: `apps/web/src/components/marketing/hero.tsx`, `how-it-works.tsx`, `local-speech.tsx`, `surfaces.tsx`, `footer-cta.tsx`
- Create: `apps/web/src/components/marketing/accent-budget.spec.tsx` — one filled control per section
- Modify: `apps/web/src/components/layout/marketing-header.tsx` — signed-in variant
- Read only: `./mockup.html`, `docs/design-guidelines.md` § Copy register, § Motion, § Elevation
- Read only: `docs/development-journey.md` — the only source for any number on the page

## Implementation Steps

1. Build the five section components against the mockup.
2. Use `measures.marketing` for the section container; the hero may run wider.
3. Add the signed-in header variant.
4. Audit every string against § Copy register before wiring anything.
5. Verify both themes and the 320px–1440px range; nothing may scroll horizontally.
6. Verify with `prefers-reduced-motion: reduce` that no section animates.
7. Write the per-section accent-budget spec.
8. Add `metadata` for `/`.
9. Run tests, typecheck, lint, build.

## Success Criteria

- [x] `/` renders signed out and signed in, with the correct header in each
- [x] `pnpm --filter web test` green, `app-skin-guard` included — the landing is the most likely place a `text-4xl` slips in
- [x] No horizontal scroll at 320px
- [x] Both themes legible; `contrast-floors` green
- [x] With reduced motion, nothing animates
- [x] Review: every claim traceable to README, the guidelines, or `development-journey.md`
- [x] Review: no banned pipeline vocabulary anywhere on the page
- [x] The accent-budget spec fails when a second filled CTA is added to any section — verify by adding one
- [x] `/` exports `metadata`
- [x] Review: one accent-filled control per viewport (the spec covers sections, not the composed page)

## Risk Assessment

**Accent sprawl.** A marketing page is the natural place to put a filled button in every
section. Signal: the per-section spec fails, or review finds two filled CTAs in one
viewport. Response: the spec catches the per-section case; the composed-page case is
still review-only, so it stays on the checklist.

**A size-name utility slips in.** `app-skin-guard.spec.ts` bans the whole size-name
family including `text-[16px]` arbitrary values, and a hero is exactly where someone
reaches for `text-5xl`. Signal: the spec fails. Response: `--text-display` exists for
this; that is what Phase 1 was for.

**Invented numbers.** Signal: a percentage, a user count, or a latency figure with no
source. Response: delete it. The only sourced numbers are in `development-journey.md`,
and a thesis product with no users has nothing else to claim.

**The hero visual drifts from the real transcript hierarchy.** Signal: the source line
rendered larger than the translation. Response: it is the same relationship the product
draws; getting it backwards on the landing teaches the wrong thing before the reader
ever arrives.

## Deviations from the plan

**Nothing animates on scroll.** The plan allowed a section entrance at `duration.base`
with `easing.enter`; it was not taken. Each band would need its own
`IntersectionObserver`, which is a `setState` in an effect per section, and what makes
this page read as finished is the elevation scale the surfaces already carry — the
plan's own "Elevation, used" paragraph says so. It also means the reduced-motion
criterion holds by construction rather than by remembering a `motion-reduce:` on every
band.

**The privacy copy is not the mockup's.** The mockup reads "Speech recognition and
synthesis run on your own CPU". That is the pipeline wearing a privacy hat, and § Copy
register bans exactly this shape — "recognise, translate, speak" is its exemplar. What
ships says what happens to the reader's voice: it is handled on their own computer and
only the words cross the network. The three hops keep the network one visible, because a
privacy claim that quietly omitted it would be the kind of claim this section exists to
be better than.

**The hero's status pill does not pulse**, where the mockup draws `dot-pulse`. It pulses
in the product because something is genuinely happening. On a still life it is
continuous motion beside static text, which the guidelines rule out.

**One number on the page, and it is in "How it works", not the hero.** "The translation
plays about a second later" — the measured ~0.9 s in `docs/development-journey.md`,
rounded in the direction that cannot flatter it. It sits on the step about there being
no stop button, because that is where a reader is asking what happens next.

**A second spec the plan did not ask for.** `landing-copy.spec.ts` runs the register
against the `web.landing.*` dictionary: no pipeline vocabulary, no component or engine
names, no measurement instruments, no language codes. The plan left this to review, and
review is the wrong instrument — the violation arrives as a copy edit that sounded
better, months later, from someone who has not read § Copy register.

**`marketing-header.spec.tsx`, also unasked.** The signed-in variant is the criterion
with no other coverage: it renders on the server behind a session read, so nothing else
in the suite exercises it. It also pins the destination as `/dashboard`, which is the
same place `DEFAULT_NEXT` sends people — the two ways back into the app agreeing is the
part that would drift silently.

**Two files beyond the plan's list.** `section.tsx`, which owns the anchor ids so an
anchor and its target are written in the same change; and `marketing-menu.tsx`, the
mobile sheet Phase 5 deferred until there was something to put in it.

**The site footer is a rule, a mark and one line.** No link columns: this product has no
legal pages, no social accounts and no company behind it, and drawing an empty nav would
be pretending otherwise.

## Verification

`pnpm --filter web test` 423/423 (26 files, from 408/23) — `app-skin-guard`,
`contrast-floors` and `token-parity` included. `typecheck` clean, `eslint src app` 0
errors and the 3 pre-existing warnings, `pnpm --filter web build` green.

Against a running dev server, `/` answers 200 and each of the three anchors has exactly
one target: `#how-it-works` (two anchors — the header and the hero's secondary),
`#on-your-machine`, `#where-it-runs`. Grepping the rendered HTML for
`recognis|synthesis|cascade|WebSocket|Gemini|latency` returns nothing.

**The accent-budget spec was verified by breaking it**, as the criterion asks: adding a
filled `Button` to `HowItWorks` fails that section's case and only that one.

**The width range was measured, not reasoned.** Headless Chrome over
320 / 375 / 768 / 1024 / 1440 px in both colour schemes: `scrollWidth === clientWidth`
at every one of the ten combinations, so nothing scrolls horizontally anywhere in the
range. The dark run also resolves `body` to `rgb(17, 18, 20)` — `#111214`, the documented
dark ground — which is the cheap proof the theme actually applied rather than the page
rendering light under a dark viewport.

What stays a review item is the aesthetic half of "both themes legible": `contrast-floors`
holds the token pairs mechanically, and whether a given section READS well in dark is a
judgement no spec makes.

## What Phase 10 inherits

- Every string on the landing is a `web.landing.*` key, so the Vietnamese is a
  dictionary file and not a component rewrite.
- `landing-copy.spec.ts` checks the English dictionary only. Pointing it at every locale
  is a one-line change and is worth making when `vi.ts` exists.
- The Interface card on `/preferences` has a language row shaped for it and empty.
- `getLocale()` in `i18n/server.ts` is still a constant; every server caller already
  goes through it.
