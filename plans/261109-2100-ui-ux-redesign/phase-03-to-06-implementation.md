# Phases 3-6: Implementation (scoped after Gate A)

Each phase: failing specs first (budget, i18n parity, contrast), smallest change using
existing shadcn/Radix, both-locale strings, screenshots at three viewports + 320px,
reduced-motion and keyboard pass, one reviewable commit.

## 3 Foundations

Type scale, spacing, focus ring, 44px targets, aria names, heading structure in
`packages/ui/src` and `apps/web/src/components/layout`. Fix every phase-1
accessibility defect here so later phases inherit it.

## 4 Core flows (order by Gate A's demo route)

`/translate` readiness + dismissible first-run (renders nothing when ready, never
blocks Start); `/conference` grid, transcript and side column at all widths;
`/history`; auth forms; preferences/account; glossary. Friendly copy and complete
empty/loading/error states. Motion only to explain change; Emil's skills for review.

## 5 Feedback and navigation

Toast or inline confirmation, and palette/shortcut, per Gate A. A toast counts as an
elevated surface: prove the two-surface budget on every screen-state it can appear in.

## 6 Verify and document

Re-run phase 1 tooling, diff against the baseline, update State inventory, write the
final report, run `pnpm --filter web test|lint|typecheck`, build production and
measure LCP/INP/CLS.

## Beauty review (every phase 4-5 route)

Before/after screenshots at three viewports go to the owner; a route is done only
after sign-off. Score the rubric (first impression, hierarchy, brand recall, motion);
re-run hallmark audit on the route.

## Rollback

One feature per commit; revert it. No data or contract changes.
