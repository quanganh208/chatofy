---
title: 'Phase 12: Docs sweep'
status: todo
priority: P2
dependencies: [11]
---

# Phase 12: Docs sweep

## Overview

Bring the documentation back in line with what the app now is. Several documents make
claims this plan falsifies, and one of them has a self-declared contract that a blank
entry is a defect.

## Requirements

- [ ] § State inventory covers every new surface and state
- [ ] § Copy register covers the new strings and the bilingual rules
- [ ] The PDR no longer calls web a landing placeholder
- [ ] `codebase-summary.md` matches the route list
- [ ] A review checklist exists for the one rule still lacking a mechanical gate

## Architecture

### `docs/design-guidelines.md`

**§ State inventory.** Its own contract: "An entry is either a `file:line` or an
explicit 'not applicable, because …'. A blank is a defect." The row for `/` currently
reads "the gap this work closes" — that gap is now closed. New surfaces needing rows:

- Landing: signed out, signed in
- Dashboard: microphone granted / denied / unknown; service reachable / unreachable
- Sidebar: expanded, rail, mobile sheet
- Translate: popover closed, popover open, popover open mid-conversation (direction and
  voice disabled)
- Preferences, Account
- Every surface in both locales — note that states do **not** multiply per locale, and
  add the note that a state whose copy exists in one locale only is a defect (TypeScript
  makes that impossible for dictionary strings, which is the argument for allowing zero
  out-of-dictionary strings)

The table also carries a standing warning that the popup rows' `file:line` refs are
stale. Do not silently re-derive them here — that is its own change, and folding it in
would hide it.

**§ Copy register.** Add the new user-facing strings, and the bilingual rules Phase 8
introduced: the register governs each locale independently; the reviewer test applies to
the Vietnamese copy alone; language names are locale-dependent where codes were banned;
the register of address is neutral "bạn".

**§ Type.** Record `--text-display`, its role, and that web applies a clamp under the
token's flat value.

**§ Where a component lives.** The eight new primitives, and the note that `sidebar.tsx`
ships variants with no consumer. Verified: `knip.json` gives `packages/ui` only spec
entries and infers `src/react/index.ts` from the `exports` map, so knip treats the whole
public surface as used and will **not** flag them. That paragraph is maintained by hand
and is the only record — exactly as it already says of `Tabs` and `Select`.

**§ Elevation.** Nothing to change in the values; worth a line that the scale is now
actually exercised (cards `md`, popover and dropdown `lg`, controls `sm`), since the
previous text noted it was released and then not used.

### `docs/project-overview-pdr.md`

Two false statements after this plan:

- "Full web app (only landing placeholder now)" sits under **Out of MVP**. Web is now a
  first-class surface. Move it into scope with a line saying when and why.
- "Account (email / OAuth) + translation history" sits under **MVP Scope** with history
  unimplemented. Say plainly that history is not built, that the tables were dropped in
  the migration squash, and that it belongs to milestone 6.

Do not quietly delete either line. A reader should find a decision, not an absence.

### `docs/codebase-summary.md` and `docs/system-architecture.md`

Route list, the three route groups, `packages/i18n`, and the `User.locale` column.
Read before writing; update the smallest owning surface rather than restating.

### The review checklist — now one rule, not two

The plan started by treating two rules as untestable. One of them turned out not to be:
`bg-primary/\d` became a row in both skin guards in Phase 2, which also caught a live
violation in `badge.tsx` that had been shipping. Record that in § Re-skinning a generated
component — the table there still describes it as a review rule with no test, and that is
now false.

What genuinely remains a review rule is **one accent-filled control per screen**, and only
partly: Phase 9 added per-section render specs for the marketing page, where sprawl
actually happens. App screens have no mechanical gate because "per viewport" is visual.

So the checklist entry is narrow and honest: _app screens — count filled controls; the
marketing page is covered by a spec._ Put it in `.claude/rules/development-rules.md`,
which the session hook already surfaces on every task. `docs/design-guidelines.md` records
_why_; the rules file records _check this_.

## Related Code Files

- Modify: `docs/design-guidelines.md` — §§ State inventory, Copy register, Type, Where a component lives, Elevation
- Modify: `docs/project-overview-pdr.md`
- Modify: `docs/codebase-summary.md`
- Modify: `docs/system-architecture.md` (only if the route or package topology it draws changed)
- Modify: `.claude/rules/development-rules.md` — the accent-once check for app screens
- Modify: `README.md` (only if setup or commands changed — they should not have)

## Implementation Steps

1. Read each document before editing it.
2. Update § State inventory with every new surface and state.
3. Update § Copy register with the new strings and the bilingual rules.
4. Record `--text-display` in § Type and the new primitives in § Where a component lives.
5. Correct the two PDR statements.
6. Update `codebase-summary.md`; touch `system-architecture.md` only if topology moved.
7. Add the UI review checklist.
8. Verify every claim against source — the guidelines cite `file:line` and stale refs
   are how that table rotted before.

## Success Criteria

- [ ] No blank or "TBD" entry in § State inventory for any surface this plan added
- [ ] Every `file:line` added in this phase resolves to the line it names
- [ ] The PDR no longer describes web as a landing placeholder
- [ ] The PDR states plainly that translation history is unbuilt and why
- [ ] `.claude/rules/development-rules.md` carries the accent-once check for app screens
- [ ] § Re-skinning a generated component no longer calls `hover:bg-primary/90` untested
- [ ] `pnpm -w test`, `typecheck`, `lint`, `build` all green on the finished branch
- [ ] Git commit messages for `.claude/` changes use neither `chore` nor `docs` — the project rule

## Risk Assessment

**Docs churn without verification.** The § State inventory table already rotted once —
its popup rows point at files a rewrite replaced — and the failure mode is adding rows
that are wrong on the day they are written. Signal: a `file:line` that does not resolve.
Response: verify each one against source as it is written; a wrong address is worse than
a missing one because it looks checked.

**The sweep silently deletes the PDR's inconvenient lines.** Signal: an out-of-scope
item vanishing rather than moving. Response: both statements get a replacement that
records the change, not a deletion.

**The review checklist is written and never read.** It is now the only defence for one
rule on one class of screen — a much smaller surface than when the plan started. Signal:
an accent-sprawl regression on an app screen after this phase. Response: it lives in
`development-rules.md`, which the session hook surfaces on every task. If it still fails,
the honest next step is a spec per app screen, not a louder checklist.
