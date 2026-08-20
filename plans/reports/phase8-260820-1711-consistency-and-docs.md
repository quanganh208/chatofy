# Phase 8 — Consistency and docs

Branch `feat/production-ui-ux`. Last phase: harvest the consistency, and correct
two documents that argued against what the plan just did.

## Unification was already done — the check found that, not new work

ThemeToggle and Alert are single shared components used by both DOM surfaces,
landed in Phases 5 and 7 rather than here. Verified rather than assumed:
`apps/web` renders `ThemeToggle` through `ConnectedThemeToggle` and `Alert` in
`live-panel`, `cascade-panel` and `baseline/page`; the popup renders both from the
same module.

Alert keeps two axes: outline + neutral for something being reported (the
non-meeting notice), fill + amber for something being asked (the microphone
grant). Both appear in the popup's screenshot set.

## Theme control out of the fold

It was below it. The plan's reasoning — three icon buttons take one row instead of
a label-plus-select block — was right about the control and wrong about the total:
`DirectionToggle` is taller than the select it replaced, so the pane still
overflowed by ~87px and Appearance was last.

Moved Appearance **above** "Runs on". Measured: the toggle's bottom is 353px on a
meeting tab and 413px on a non-meeting tab, against a pane bottom of 470px —
visible without scrolling in both. "Runs on" is now what you scroll to, which
costs it nothing: reachable was the whole requirement on it.

## Two documents corrected

**`packages/ui/README.md`** — "Tokens, not components" listed three reasons
components were refused. The overlay and mobile reasons are kept **word for word**;
only "a shared component would have at most one consumer" is removed, because that
is the one the work falsified. Replaced the prose conclusion with a table of which
surface renders from where, since the boundary is no longer components-vs-tokens
but which surface.

**`apps/extension/wxt.config.ts`** — my own Phase 6 edit had **deleted** the CSP
reason while rewriting that comment, which is exactly what this phase was written
to prevent. Restored as a live constraint: MV3's policy did not become wrong, it
became _satisfied_, and a dependency upgrade can undo that without a line of this
repo changing — so it now names the two gates that hold it.

**`docs/design-guidelines.md`** — added, not corrected. New "Where a component
lives" section: the four-surface table, the primitive-vs-composition boundary with
the two-real-consumers rule, why compositions are controlled, and a re-skin table
mapping each stock shadcn habit to this project's replacement and the reason.
Records that Voice is still two controls and why.

## Found by looking at the screenshots

`DirectionToggle` rendered "Vietnamese" as "Vietnam…" on the web page. `flex-1`
sets the flex basis to 0, so each side started from nothing and took only its share
of free space — invisible in the popup, where the component fills a 288px column,
and visible on the web page where it sits in a content-sized row beside the voice
control. Changed to `grow basis-auto`; `min-w-0` and `truncate` stay, because they
are the narrow surface's safety net.

A first attempt at `min-w-fit` on the root did nothing — fit-content is computed
with the children's `min-width: 0`, so the root was already as small as they were.

Also `w-fit` on the popup's ThemeToggle: in a flex column a stretched item drew the
pill's border across the full 288px around three small icons.

## Screenshots, both surfaces × both themes, looked at

Popup light/dark and web `/` and `/translate` light/dark. Both surfaces show the
same direction control, the same theme toggle, the same accent, and the accent
appears once per screen. No page errors in either theme.

## Gates

`turbo lint typecheck test build` 28/28 · `verify:build` 10/10 · e2e **65/0** ·
knip at baseline. The web server started for the screenshots was stopped and port
3001 confirmed released.

## Unresolved

- Voice remains a `SegmentedControl` on web and a Radix `Select` in the popup —
  deliberate, now documented in `docs/design-guidelines.md`.
- The e2e screenshot set is single-theme. Both themes were captured by hand here;
  making that permanent would double the set and was not in scope.
