---
title: 'Phase 4: Adoption across every call site'
status: complete
priority: P2
effort: '0.75d'
dependencies: [3]
---

# Phase 4: Adoption across every call site

## Overview

Delete both hand-rolled field strings, point every control at the shared
components, and fix the two off-system values that survive in the app layer.
Repetition of shapes proven in phases 2 and 3.

## Requirements

**Functional**

- No app file declares its own control class string.
- Web and popup sign-in forms are the same shape: full-width controls, same
  heights, same gaps.
- Public behaviour unchanged except one deliberate security fix (below). Every
  form still submits, and both sign-in surfaces keep a **non-discriminating**
  failure message: the API answers a wrong password and an unknown email
  identically (`login-form.tsx:11-19`), and the popup renders `popup.signInError`
  verbatim for the same reason (`sign-in-pane.tsx:72-79`).
- `next` is clamped to same-origin before `router.push`. Today
  `params.get('next')` flows unvalidated into `router.push(next as ...)`
  (`login-form.tsx:30` → `:49`), where the cast suppresses the type system's only
  objection, and `auth.ts` declares no `redirect` callback — so the Google path
  inherits Auth.js's same-origin clamp while the credentials path has none.
  `?next=https://evil.example` lands a just-authenticated user on an attacker
  origin. Pre-existing and unrelated to the restyle, fixed here because this phase
  opens the file.

**Non-functional**

- Popup stays within 320×600 with no horizontal scroll.

## Architecture

The four `variant="outline"` call sites sit on three different grounds, which is
why the old treatment measured differently at each and why phase 3's change lands
unevenly:

| Call site                      | Ground                                           |
| ------------------------------ | ------------------------------------------------ |
| `google-button.tsx`            | page `--background`                              |
| `audio-source-controls.tsx:51` | inside a `Card`                                  |
| `settings-pane.tsx:114`        | inside an `Alert` — the hard ground from phase 3 |
| `direction-toggle.tsx:53`      | inside a `Card`                                  |

`DirectionToggle` is **not** a segmented control — it is one round icon button that
swaps two labelled readouts (`direction-toggle.tsx:52-65`; the segmented control is
a different component, `SegmentedControl`). The real work at this call site is
`direction-toggle.tsx:59`'s `hover:border-muted-foreground`, which goes inert the
moment phase 3 removes the border width. Replace it with a hover that acts on what
the button now has — fill and elevation. Note also that `:61` overrides the size
with `size-auto`, so nothing here may assume a fixed height.

The login page also carries the last two off-system values in the repo:
`text-2xl` at `login/page.tsx:36`, which is the only place in the codebase using
a size name instead of a role token, and the absence of the `Card` every other
content surface uses.

## Related Code Files

- Modify: `apps/web/src/components/auth/login-form.tsx` — delete `const FIELD`,
  use `Input`
- Modify: `apps/extension/entrypoints/popup/sign-in-pane.tsx` — delete
  `const field`, use `Input`
- Modify: `apps/web/src/components/auth/google-button.tsx` — full width, Google
  mark, quiet variant
- Modify: `apps/web/app/login/page.tsx` — `text-title` for the heading, `Card`
  wrapper, labelled separator between the two sign-in paths
- Modify: `apps/web/src/components/translate/audio-source-controls.tsx`
- Modify: `apps/extension/entrypoints/popup/settings-pane.tsx`
- Modify: `packages/ui/src/react/direction-toggle.tsx` — segment treatment
- Decide: `packages/ui/src/react/select.tsx` — consumer-less today; either follow
  C1 now or record why it keeps the old trigger. Do not leave it undecided.

## Implementation Steps

1. Replace both hand-rolled fields with `Input`. Keep each file's existing
   `autoComplete` values — they are correct and easy to lose in a rewrite.
2. Google button: `w-full`, the four-colour Google mark as inline SVG at 18px,
   quiet variant. The mark is Google's asset and stays four-colour; recolouring it
   is not permitted by their brand terms.
3. Login page: heading to `text-title`, wrap the form in `Card`, add the labelled
   separator. Two structures already in that file are load-bearing and must survive:
   - The `Card` goes **inside** `<Suspense>`. `page.tsx:49-50` records that
     `useSearchParams` in both children needs the boundary or "the whole route opts
     out of static rendering" — and the de-opt is silent.
   - The separator renders **only when `googleConfigured`** (`page.tsx:53`). That
     server-side gate mirrors `auth.ts:89-101`, where the provider is registered
     only if both halves are configured. A fixed two-route layout would render
     "or continue with email" — and possibly the Google button — on a deployment
     with no `AUTH_GOOGLE_ID`, which is precisely the "button that errors, or a
     hidden one that would have worked" outcome the file warns about twice.
4. Popup sign-in: same control heights and gaps as web. It is already `w-full`;
   web moves to match it, not the reverse.
5. Swap the remaining `variant="outline"` call sites; verify each on its own
   ground rather than assuming one screenshot covers all three.
6. `DirectionToggle`: replace the now-inert `hover:border-muted-foreground` with a
   fill/elevation hover. Keep `size-auto` and the round shape.
7. Clamp `next` to same-origin in `login-form.tsx` and drop the cast that was
   hiding the type error. Add a spec for it.
8. Resolve the `Select` question and record the answer in
   `docs/design-guidelines.md`'s "Where a component lives" section, which already
   tracks consumer-less primitives by hand because `knip` cannot see them.

## Success Criteria

- [x] `grep -rn "const FIELD\|const field" apps/` returns nothing.
- [x] `grep -rn "border-hairline" apps/ packages/` hits only surface separators.
- [x] `grep -rnE "text-(xs|sm|base|lg|xl|[0-9]xl)\b" apps/ packages/ui/src` returns
      nothing outside comments.
- [x] Web and popup sign-in forms screenshot to the same control rhythm, with
      `Input` and `Button` both at 40px.
- [x] A spec asserts both sign-in surfaces emit exactly one non-discriminating
      failure string. The web copy lives in a handler, not a prop, so a prop diff
      cannot protect it.
- [x] A spec asserts the rendered inputs carry their `type`, `required` and
      `autoComplete` values.
- [x] A spec asserts `next` cannot leave the origin.
- [x] With Google unconfigured, the page shows the email path alone — no separator,
      no Google button.
- [~] The login route is still statically rendered (no silent dynamic de-opt).
  **Premise was false.** `next build` reports `ƒ /login` — server-rendered on
  demand — both before and after this work, because `await auth()` at the top
  of the page reads the session cookie. The route has never been static, so
  there was no static rendering to lose. The `<Suspense>` boundary is kept and
  asserted anyway: it is what keeps the page buildable if the signed-in check
  ever moves to middleware and the route becomes static again.
- [x] `pnpm --filter extension test:e2e` green including the signed-out scenario
      added in phase 1 — that is the only run that measures the pane this phase
      rewrites.
- [x] Login page keyboard path works end to end: tab order, visible focus on every
      stop, submit on Enter.
- [x] `pnpm turbo run test` green.

## Risk Assessment

**The `Alert` action is the one that will not be right first time.** It was the
weakest ground before this plan and C1 does not help it. _Signal:_ the mic-allow
button in `settings-pane.tsx` is hard to find inside its notice. _Response:_
phase 3's hue-tinted fill, then the recorded per-surface escalation if that is not
enough.

**Popup regressions at 320px from wider glyphs plus new control padding.**
Compounding with phase 1's font change. _Signal:_ e2e horizontal-scroll failure.
_Response:_ padding, not type scale. The type scale is shared and changing it here
re-creates the divergence the plan exists to close.

**A silent behaviour change smuggled into a restyle.** _Signal:_ password managers
stop filling; the login error becomes specific enough to reveal whether an email
exists. _Response:_ the three specs above, not a prop diff — the generic error is a
string literal inside the submit handler (`login-form.tsx:42`), so it survives any
prop-level comparison while a handler rewrite around it changes meaning.
