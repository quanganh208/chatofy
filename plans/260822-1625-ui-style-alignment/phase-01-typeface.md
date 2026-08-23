---
title: 'Phase 1: One typeface on both surfaces'
status: complete
priority: P2
effort: '0.5d'
dependencies: []
---

# Phase 1: One typeface on both surfaces

## Overview

Replace Inter with Be Vietnam Pro on `apps/web`, and give the extension popup the
same face for the first time. Today web loads Inter through `next/font` and the
popup falls back to `system-ui`, so the two surfaces have never matched.

## Requirements

**Functional**

- Web and popup resolve the same family at runtime.
- Vietnamese diacritics render from the font's own vietnamese subset, not a
  fallback face. Verified: `fonts.googleapis.com` serves a `/* vietnamese */`
  block for Be Vietnam Pro.
- No third-party request **at page load** on either surface. Note precisely what
  this does and does not claim: `next/font` fetches from Google **at build time**
  on every clean build, unpinned. Only the runtime is third-party-free.
- The popup keeps a fallback tail. If an `@font-face` fails to load, the surface
  must degrade to a real stack, not to nothing.

**Non-functional**

- No layout shift waiting on a font (`display: swap`, as today).
- Popup must not gain a dangling custom-property reference — the failure
  `theme.css:15-18` documents and deliberately avoided.

## Architecture

Be Vietnam Pro is a **static** family, not variable. `next/font/google` therefore
requires an explicit `weight` array; omitting it fails the build. Ship `400`,
`500`, `600`, `700` — the four the components use (body, control label, heading,
nothing heavier).

The indirection web uses stays exactly as-is and for the reason already recorded
in `layout.tsx:12-17`: the font variable must not be named `--font-sans`, because
Tailwind v4 declares that name inside `@layer theme` and the two would rely on a
source-order accident. Rename the variable to `--font-be-vietnam` and re-point the
`@theme inline` alias.

The popup cannot use `next/font`. It declares `@font-face` in `theme.css` against
woff2 files bundled with the extension, then sets the same `--font-sans` alias.
Subset to latin + vietnamese to keep the packed size down; the popup ships no other
language.

**The popup's `body` rule must stay unlayered, and must keep declaring
`font-family`.** This is the single easiest way to break this phase. Tailwind's
preflight is imported as `layer(base)` (`theme.css:47`), and a layered rule loses
to Chrome's own popup default sheet — which sets `body` at 12px in the system font
and does not appear in `document.styleSheets` at all. `theme.css:34-42` records
that failure from experience and ends "Nothing in the page can be inspected to
explain it." So `style.css:27` changes **value only**: the declaration and its
unlayered position stay exactly where they are.

**What a parity spec can and cannot check.** `next/font` mints a build-time hashed
family (`__Be_Vietnam_Pro_<hash>`) that appears in no source file, and
`token-parity.spec.ts` compares each stylesheet against `tokens.ts` rather than
against the other (`token-parity.spec.ts:44-46`, `:265`). There is no anchor for a
string comparison of the two families, and adding a family token to `tokens.ts`
would push a DOM font name onto the root entry `apps/mobile` imports. So the spec
checks the family segment against a shared constant; runtime equality is confirmed
once per surface by hand, like the diacritic check below.

## Related Code Files

- Modify: `apps/web/app/layout.tsx` — swap the import and the variable name
- Modify: `apps/web/app/globals.css` — re-point the `--font-sans` alias (line 40)
- Modify: `apps/extension/entrypoints/popup/theme.css` — add `@font-face` and the
  alias; rewrite the comment at lines 14-18, which currently explains why the
  popup does **not** have this font
- Modify: `apps/extension/entrypoints/popup/style.css` — drop the `system-ui`
  literal at line 27 in favour of the token
- Create: `apps/extension/public/fonts/be-vietnam-pro-{400,500,600,700}.woff2`
  (subset latin+vietnamese)
- Modify: `apps/web/src/design/token-parity.spec.ts` — the popup stylesheet now
  carries a font declaration the web side must agree with, **and**
  `DECLARED_ELSEWHERE` at `:143` currently holds `--font-inter`; renaming the
  variable reds the "no @theme alias pointing at a variable that does not exist"
  test at `:433-443` if this is missed
- Create: `apps/extension/public/fonts/OFL.txt` — the license the face ships under
- Create: `apps/extension/scripts/build-fonts.mjs` — the pinned, re-runnable
  subsetting invocation, so the committed binaries are reproducible rather than
  merely described
- Modify: `apps/extension/e2e/run.mjs` — add a signed-out popup scenario (see step 0)

## Implementation Steps

0. **Before anything else**, add a signed-out popup scenario to `e2e/run.mjs`.
   The file defaults `signedIn = true` (`run.mjs:1306-1310`) with a comment saying
   the shots are about settings, so the horizontal-overflow check at `:1411` has
   never rendered `#sign-in`. Without this, the safety net for this phase's stated
   top risk does not cover the pane the phase changes.
1. Fetch the four static weights from a **pinned** upstream release and subset to
   latin + vietnamese via `scripts/build-fonts.mjs`. Commit the SHA-256 of each
   source and each emitted woff2, the tool and version, and `OFL.txt`. A comment
   recording a URL is provenance prose, not integrity: no reviewer can tell whether
   four opaque binaries are the face they claim to be.
2. Swap `Inter` → `Be_Vietnam_Pro` in `layout.tsx` with the explicit `weight`
   array; rename `variable` to `--font-be-vietnam`. Keep the existing comment
   about not naming it `--font-sans` — it is still the load-bearing reason.
3. Re-point `globals.css:40` to the new variable.
4. Add `@font-face` rules to the popup's `theme.css` and alias `--font-sans` to
   the family. Replace the "does not exist here" comment with what is now true.
5. In `style.css:27`, change the **value** to `var(--font-sans)` and nothing else.
   Do not delete the declaration and do not move it into a layer — see Architecture.
   Keep a fallback tail inside `--font-sans` in `theme.css` so a failed
   `@font-face` degrades to a real stack.
   5b. Add `--font-be-vietnam` to `DECLARED_ELSEWHERE` in `token-parity.spec.ts`.
   5c. Do **not** add these files to `web_accessible_resources`. The popup is an
   extension page loading from its own origin and needs no entry; `wxt.config.ts:112-118`
   records that adding one both fails the manifest at load time and makes the
   extension id probeable from meeting origins. Written here because a font 404 in
   the popup is exactly the bug that sends someone to that setting.
6. Extend `token-parity.spec.ts` so the font declaration is compared across both
   stylesheets rather than trusted, matching how that spec already treats colour
   and radius.

## Success Criteria

- [x] Both stylesheets declare `--font-sans` with a matching family segment and a
      fallback tail; the rendered face is confirmed once per surface in devtools.
- [x] The popup's `body { font-family }` declaration still exists and is still
      unlayered.
- [x] `ẫ ệ ợ ữ ỹ ẳ ộ ắ ề Đ` render from Be Vietnam Pro on both surfaces with no
      fallback substitution — checked as the rendered font in devtools, not by eye.
- [x] No runtime request to `fonts.googleapis.com` / `fonts.gstatic.com`. The
      build-time fetch by `next/font` is expected and is not what this asserts.
- [x] The four woff2 files are present in `.output/chrome-mv3` after a build.
- [x] Checksums, pinned version, subsetting script and `OFL.txt` committed.
- [x] Popup packed size increase recorded in the PR description. **+60.0 KB** of
      woff2 (four already-compressed files) plus 4.4 KB `OFL.txt`; the build output
      grew from 623 KB to 688 KB.
- [x] `pnpm turbo run test` green; `token-parity.spec.ts` covering the font and the
      renamed variable.
- [x] `pnpm --filter extension test:e2e` green **with the new signed-out scenario**:
      no horizontal scroll at 320px on the sign-in pane. Be Vietnam Pro is wider
      than Inter at the same size, so this is the phase's real gate.

## Risk Assessment

**The popup overflows 320px because the new face is wider.** Be Vietnam Pro's
advance widths differ from Inter's. The e2e was _not_ holding this line for the
sign-in pane — step 0 is what makes the risk detectable at all. _Signal:_ the no-horizontal-scroll e2e fails, or Start crosses 600px.
_Response:_ adjust the popup's padding scale, not the type scale — the type scale
is shared with web and changing it here would re-introduce the divergence this
phase exists to remove. If padding alone cannot recover it, replan the phase
rather than shipping a popup that scrolls sideways.

**Static-weight import fails the build.** _Signal:_ `next/font` errors that
`weight` is required. _Response:_ it is expected, not a surprise — supply the
array. Recorded here so it is not diagnosed twice.

**Subsetted files drift from the upstream face.** _Signal:_ a glyph missing months
later with no way to tell which subset produced the file. _Response:_ the source
URL and unicode ranges are committed in a comment beside `@font-face` in step 1.
