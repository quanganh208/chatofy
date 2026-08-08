---
phase: 2
title: 'Design guidelines and token decision'
status: pending
priority: P1
effort: '2h'
dependencies: []
---

# Phase 2: Design guidelines and token decision

## Overview

Write `docs/design-guidelines.md`, the anchor `apps/mobile/src/ui/theme.ts:1`
has claimed exists since it was written. It is the first artifact because it is
reversible, needs no code, and unblocks web, extension and mobile at once.

## Requirements

- Functional: every value later hardcoded in `tokens.ts` is justified here first, including which surface may deviate and why.
- Non-functional: fits the existing `docs/` voice — reasons, not rules; no phase numbers or plan IDs in the document.

## Architecture

The document is product-anchored, not generic. This app has states no generic
design system names: _capturing_, _hearing you_, _translating_, _speaking_,
_muted_, _page not patched_. Each needs one colour with one meaning, used the
same way on all three surfaces. That mapping is the actual content; the palette
is the supporting detail.

Three theme facts to record, because each is a constraint someone will otherwise
try to "fix":

1. The overlay is permanently dark and must never read `prefers-color-scheme` — inside a content script that reflects the OS, not the page.
2. Web is dark-only for now. Light is deferred, not rejected; the `@custom-variant dark` machinery in `globals.css` stays.
3. `z-index` and the overlay font stack are overlay-local and never tokenized.

## Related Code Files

- Create: `docs/design-guidelines.md`
- Reference (do not modify yet): `apps/mobile/src/ui/theme.ts`, `apps/web/app/globals.css`, `apps/extension/entrypoints/content/index.ts`

## Implementation Steps

1. Record the direction and the one-sentence reason it was chosen: the overlay cannot be light, so a light web can never match it.
2. Write the palette table — neutral, accent, state — with hex, the token name it will carry, and where it is allowed to appear.
3. Write the semantic state map: `live` = capture is running / stop action; `speaking` = a translation is playing; `warning` = user action outstanding (microphone grant, page not yet patched); `accent` = the primary action and selected state, nothing else.
4. Write the type scale (11/12/14/17/22/28, weights 400/500/600) and name the role of each step. Note that web uses a display font and the overlay stays on its own explicit system stack.
5. Write the spacing (4/8/16/24/32/48/64) and radius (6/10/14/full) scales. Note explicitly that these **replace** the scales in `apps/mobile/src/ui/theme.ts` — that file ships radii 4/8/16 and type 12/14/16/18/22/28/36, which disagree with these at nearly every step. Its scales are scaffolding marked "for upcoming screens" and no screen consumes them, so the shared scale wins; `spacing` keeps mobile's extra `64` step.
6. Compute and record the actual contrast ratios: `textMuted`, `textSecondary` and `text` against both `bg` and `surface`, as a table. Phase 4 and phase 5 apply this table instead of eyeballing contrast, so a promise here is not enough — numbers, and a stated minimum size for each.
7. Write the three constraint notes from Architecture above.
8. Add a short component-state section: default / hover / active / disabled / focus-visible, and the rule that focus-visible is mandatory in the overlay because it sits on a page whose styles guarantee nothing.
9. Record the rule that `live` and `speaking` must never be distinguished by colour alone — they are red and green, and a status dot is exactly where that fails.
10. Link the document from `README.md`'s Docs section.

## Success Criteria

- [x] `docs/design-guidelines.md` exists and is under the repo's 800-line docs cap
- [x] Every colour later appearing in `tokens.ts` appears here with a stated role
- [x] The contrast table carries real numbers, and a minimum text size per row
- [x] The scale-replacement decision for mobile is written down, not implied
- [x] The overlay dark-only and no-`prefers-color-scheme` rules are written down
- [x] `apps/mobile/src/ui/theme.ts:1` now points at a file that exists
- [x] Linked from `README.md`

## Risk Assessment

- **The document drifts from the code the moment phase 3 lands.** Signal: a hex in `tokens.ts` with no entry here. Response: phase 4's parity test covers `globals.css` ↔ `tokens.ts`; this document is reconciled by hand at the end of phase 6 and that reconciliation is a checklist item there, not a hope.
- **Over-specification.** A guidelines doc that describes components nobody has built is dead weight. Keep it to tokens, state meanings, and the three constraints.
