---
title: 'Phase 5: Docs and contrast floors reconciled'
status: complete
priority: P1
effort: '0.5d'
dependencies: [4]
---

# Phase 5: Docs and contrast floors reconciled

## Overview

Make the written record match what ships. After phase 3 the codebase contains
several comments and one test table that describe a rule the product no longer
follows — and they are persuasive, well-argued comments, which makes them worse
than silence. Someone will restore the border on their authority.

Priority P1 despite being documentation: the risk this phase removes is the plan
being quietly undone.

## Requirements

**Functional**

- No document or comment claims controls carry a 3:1 outline.
- The C1 decision, its measured cost, and the reason it was accepted are written
  where the next reader will look — not only in this plan directory.
- `contrast-floors.spec.ts` measures what is rendered.

**Non-functional**

- Do not delete the reasoning behind the old rule. Replace it with the new rule
  and the measurement that motivated the change. A rule with no recorded reason is
  the thing that caused three rounds of review on this branch.

## Architecture

Four places state the superseded rule, in descending order of how convincing they
are to a future reader:

1. **`globals.css:231-235`** — _"`--border-control` is the boundary of a control at
   3.03:1 and does not recede — never substitute this for it."_ Directly forbids
   what C1 does.
2. **`docs/design-guidelines.md:264-278`** — "Component states": default is
   _"`surfaceRaised` fill or a `borderControl` outline"_. Needs a third form: the
   C1 depth pair.
3. **`packages/ui/src/tokens.ts:74-78`** — records `borderControl` as solved
   against `surfaceRaised` _"since that is the ground a control actually sits on"_.
   Still true of the token; no longer true of any rendered control.
4. **`contrast-floors.spec.ts:53-64`** — the 3:1 rows. These do **not** fail under
   C1, because they measure the token against grounds and the token still
   contrasts. They become green rows asking a question nothing answers, which is
   worse than a red one.

   The block at `:65-85` is a different case and must **not** be rewritten. It
   argues that `alert.tsx` re-borders a notice's actions in the notice's hue, and
   row `:85` measures that border. Phase 3 keeps both, so this block stays true —
   it now documents the recorded exception to C1 rather than the general rule. Add
   one sentence saying so; change nothing else. The same applies to `alert.tsx:41-57`.

For the spec, the honest move is to keep measuring `borderControl` but say what it
is now for. It survives as the token used where a real boundary is still wanted —
the escalation path phase 3 reserves for notice actions — so the rows keep their
value and lose their false implication of universality.

`design-guidelines.md:264-278` also currently prescribes focus as _"a 2px
`accentText` ring, offset 2px"_ while seven primitives ship
`ring-[3px] ring-ring/50` with `border-ring`, and `app-shell.tsx` alone follows the
document. That contradiction predates this plan and is cheap to settle here: adopt
the shipped form, since `--ring` measures 6.70:1 at worst on every ground and is now
carrying more of the identification load than before. (`app-shell.tsx` follows the
document in two places, `:58` and `:66`, not one.)

## Related Code Files

- Modify: `apps/web/app/globals.css` — rewrite the hairline/border-control comment
- Modify: `apps/extension/entrypoints/popup/theme.css` — same comment, if mirrored
- Modify: `packages/ui/src/tokens.ts` — scope the `borderControl` note
- Modify: `docs/design-guidelines.md` — component states, focus rule, the C1
  record, and `Input` added to the primitives list
- Modify: `apps/web/src/design/contrast-floors.spec.ts` — rewrite the 3:1 rows and
  their comments
- Modify: `apps/web/src/design/token-contrast.spec.ts` — check whether it repeats
  any superseded claim
- Modify: `packages/ui/src/react/skin-guard.spec.ts` — extend its file scan to the
  app surfaces, which today it does not reach

## Implementation Steps

1. Rewrite the `globals.css` comment: `--border-control` is the token for a
   boundary that must be found without hover, kept for the escalation path; the
   default control language is C1's depth pair. State the measured cost —
   1.13:1 light, 1.17:1 dark — so nobody re-derives it.
2. Add a "Control depth" rule to `docs/design-guidelines.md` describing the
   field/button opposition, and record the C1 decision with its numbers and the
   fact that it was accepted knowing them.
3. Settle the focus contradiction in favour of the shipped 3px form; fix
   `app-shell.tsx` to match.
4. Add `Input` to the primitives list, and update the hand-maintained
   consumer-less note with the `Select` decision from phase 4.
5. Rewrite the `contrast-floors.spec.ts:53-64` rows and comments per Architecture.
   Keep the rows; change what they claim. Leave `:65-85` and `alert.tsx:41-57`
   intact apart from a sentence marking them as the exception.
6. Extend the lint guard to the app surfaces. Three things must be right or the
   extension is worse than not doing it:
   - **Recursive walk.** Today `SOURCES` is a non-recursive `readdirSync`
     (`skin-guard.spec.ts:22-24`). `apps/web/src` and `apps/web/app` have **zero**
     top-level `.tsx`; 17 of their 19 files sit two or more levels deep. Reusing
     that mechanism scans nothing.
   - **Per-root floor.** The existing `expect(SOURCES.length).toBeGreaterThan(10)`
     (`:71-74`) is already satisfied by the package's own files, so a root
     resolving to nothing cannot be told from a root that is clean. Assert a
     minimum per scanned root, the way `overlay-invariants.spec.ts:129-131` proves
     it read something.
   - **Widen the type pattern.** The current ban is `/\btext-sm\b|\btext-xs\b/`
     (`:59`), which does not match `text-2xl` — the very violation phase 4 removes.
     Widen to the full size-name family and to `text-[NNpx]` arbitrary values.
     Decide where this lives: putting it in `packages/ui` makes a shared package's
     spec read app source by relative path, inverting the dependency direction.
     `apps/web/src/design/` already reaches across app boundaries and is the likelier
     home. Expect pre-existing violations; fix or explicitly allow each.

## Success Criteria

- [x] `grep -rn "never substitute this for it" .` returns nothing, or returns a
      sentence that is true of what ships.
- [x] `docs/design-guidelines.md` describes the C1 control language, lists `Input`,
      and states one focus rule that matches the components.
- [x] `contrast-floors.spec.ts:53-64` describe rendered surfaces; `:65-85` is
      marked as the recorded Alert exception and otherwise untouched.
- [x] The extended guard reads a **verified non-zero** count of files from each
      scanned root, and its type-scale pattern matches `text-2xl` and
      `text-[16px]`. A green run over an empty corpus is the failure mode here.
- [x] Whole-plan sweep: no file in this plan directory still describes C2, the
      `redesign.html` composition, or the old outline as the accepted direction.
- [x] `pnpm turbo run test` and `pnpm --filter extension test:e2e` green.

## Risk Assessment

**The extended guard fails open and nobody notices.** More likely than a pile of
violations: a non-recursive walk returns zero app files, every ban passes
vacuously, and the empty result reads as "the apps are clean". _Signal:_ the
scanned-file count for a root is zero, which is why the per-root floor is a
requirement and not a nicety. _Secondary signal:_ the scan fails on files this plan
never touched. _Response:_ fix what is genuinely the same class
of bug; for anything else, add an explicit allowance with a reason rather than
narrowing the scan. A guard weakened to pass is worse than no guard.

**Docs updated to describe the intent rather than the result.** _Signal:_ the
guidelines describe hover and press behaviour the components do not implement.
_Response:_ write this phase last, from the shipped components, and verify each
claim against source — which `documentation-management.md` already requires.

**The C1 exception is recorded here and nowhere a future accessibility audit will
look.** _Signal:_ an audit reopens the 1.4.11 question with no context and the
decision gets reversed by default. _Response:_ the record in
`docs/design-guidelines.md` names the measurements, the rejected alternative
(C2), and that the trade-off was accepted deliberately — enough for an auditor to
disagree on the merits rather than assume an oversight.
