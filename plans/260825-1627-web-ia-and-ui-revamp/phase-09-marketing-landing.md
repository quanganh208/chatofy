---
title: 'Phase 9: Marketing landing'
status: todo
priority: P1
dependencies: [8]
---

# Phase 9: Marketing landing

## Overview

Replace the lean entry page at `/` with a full marketing landing. This is where "đẹp
hơn" is actually won — the app surfaces are already disciplined.

## Requirements

- [ ] `/` is public and renders under the marketing chrome
- [ ] Four to five sections, ending in a CTA
- [ ] Every claim is true and traceable to the repo
- [ ] Exactly one accent-filled control per viewport

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

- [ ] `/` renders signed out and signed in, with the correct header in each
- [ ] `pnpm --filter web test` green, `app-skin-guard` included — the landing is the most likely place a `text-4xl` slips in
- [ ] No horizontal scroll at 320px
- [ ] Both themes legible; `contrast-floors` green
- [ ] With reduced motion, nothing animates
- [ ] Review: every claim traceable to README, the guidelines, or `development-journey.md`
- [ ] Review: no banned pipeline vocabulary anywhere on the page
- [ ] The accent-budget spec fails when a second filled CTA is added to any section — verify by adding one
- [ ] `/` exports `metadata`
- [ ] Review: one accent-filled control per viewport (the spec covers sections, not the composed page)

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
