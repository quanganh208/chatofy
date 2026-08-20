# Brainstorm — production-grade UI/UX for web + extension

Mode: `ak:brainstorm --ultra --advice`. Best-of-5 verifier pass; winner materialized
unchanged apart from the citation corrections the verifier named. Ranking appendix at the end.

Request (verbatim): "hiện tại tôi thấy UI/UX chung, của web và của extension rất xấu,
không đẹp chút nào, thiết kế khá rối, cần theo để làm production chứ không tạm thời để
test được".

Scope: `apps/web` + `apps/extension`. `apps/mobile` not named, excluded.

## The finding that reframes the problem

The token layer is not the problem and must not be reopened. `packages/ui/src/tokens.ts`
plus `docs/design-guidelines.md` justify every value with measured contrast, and
`token-contrast.spec.ts` / `token-parity.spec.ts` enforce it.

Two tokens never reached web, and nothing catches it:

- `borderStrong` (`packages/ui/src/tokens.ts:37`) and `textSecondary`
  (`tokens.ts:50`) are **absent from `apps/web/app/globals.css`** — verified, zero hits.
- Both are **absent from `token-parity.spec.ts`'s `MAPPING`**, so the parity test cannot
  see the omission.

`textSecondary` is the token the guidelines assign to "the source transcript, supporting
prose" (9.67 on bg). Without it, every non-heading string on web is `--foreground` (16.83)
or `--muted-foreground` (5.92) — shouting or near-disabled, nothing between. The extension
_does_ render that middle step. That is a measurable, plumbing-level reason web reads
flatter than the extension, and it is a two-line CSS change plus a mapping entry.

Everything else is above the token layer: information architecture, hierarchy, and copy
register.

## 1. OUTCOME

**Web**

- `/` becomes a real page: brand, one sentence of what the product does, one primary button
  into the translator. Today `apps/web/app/page.tsx` is 8 lines with zero `className` and no
  link to `/translate` — an unstyled browser default.
- `/`, `/translate` and the turn-based page share page chrome: identical content width,
  padding, vertical rhythm, and a way back. Today `apps/web/app/translate/page.tsx:45`
  declares `max-w-2xl … gap-8 px-6 py-10` while `apps/web/app/translate/baseline/page.tsx:41`
  declares `max-w-xl … justify-center gap-6 p-6`, and the baseline page has no link back —
  three unconnected documents.
- Supporting prose reads at a legible middle weight instead of a 2-step cliff (the
  `textSecondary` finding above).
- Type comes from the product scale, not Tailwind's defaults. Today `translate/page.tsx:48`
  h1 is `text-2xl` (24px) against the scale's `xl` 28; `cascade-panel.tsx:90` h2 is
  `text-lg` (18px) against `lg` 22; `conversation-transcript.tsx:59,73` and
  `live-panel.tsx:175` hand-write `text-[17px]` / `text-[22px]`. Web headings (24/18)
  disagree with the overlay's — typographically two different products.
- No engineering instrument on the user-facing path. Gone: `"heard during playback: {n}"`
  and its barge-in/echo tooltip (`cascade-panel.tsx:145`); the mode toggle labelled with
  backend names `Cascade`/`Live` (`mode-toggle.tsx:23,32`); the footer link
  `"Turn-based baseline"` (`translate/page.tsx:75`); `"Heard vi, but this direction expects
en"` (`live-panel.tsx:142-151`); prose that explains mechanism —
  `"Unlike the cascade, this does not wait…"` (`live-panel.tsx:87`),
  `"that is the model, not the connection"` (`live-panel.tsx:181-182`).

**Extension**

- The popup shows **one** primary thing to do plus one settings group, not six controls of
  equal weight ahead of the button. Today `entrypoints/popup/index.html` renders 4 top-level
  `<label>` + control pairs (`#direction`, `#mode`, `#voice`, `Runs on`) and 3 checkboxes at
  the same 11px-uppercase weight before `<footer>`'s `#toggle`.
- Popup copy is user language, not backend names: `<option>` values
  `"Cascade — a turn at a time"` / `"Live — speaks while you talk"` (`index.html:82-83`) and
  `"Report timings for measurement"` (`index.html:137`) are gone. The register already exists
  two lines away — `popup/main.ts`'s `refreshModeNote()` writes "Answers about three seconds
  behind and talks over pauses — wear headphones."
- The overlay panel makes the transcript dominant, not the fifth of six stacked bars. Today
  `entrypoints/content/overlay.ts` appends `header, indicator, errorBox, outboundBox, list,
controls`, and `.controls` holds Start + two `select.setting` + a checkbox + a hint in one
  wrapped 340px row.
- Web and popup share a typeface. Both `popup/styles.ts` and `overlay-styles.ts` use
  `system-ui, -apple-system, 'Segoe UI'` while web uses Inter (`app/layout.tsx`). The
  overlay's system stack is **mandated** (inheriting the page font is an injection surface);
  the popup's is **not** — its own docstring calls it "an ordinary extension page: no shadow
  root, no third-party DOM, and nothing hostile to defend against". Two of three surfaces
  unify; the overlay stays system by rule.

**Operational**

- One styling idiom in web: `grep -rn "\[var(--color-" apps/web/{app,src}` → 0 (today **9**
  hits across `ui/card.tsx`, `translate/result-card.tsx`, `translate/audio-source-controls.tsx`,
  `translate/baseline/page.tsx`).
- The parity test guards the whole token surface. Today `MAPPING` omits `borderStrong` and
  `textSecondary` and asserts nothing about `fontSize`, `space` or `fontWeight` — a token can
  be added to `packages/ui` and never reach web, silently, which is exactly what happened.

## 2. CONSTRAINTS

**Non-negotiable, safety/platform**

1. Overlay stylesheet interpolates **literal values, never `var()`** — `:host { all: initial }`
   does not reset custom properties, so a variable-themed overlay is repaintable by the meeting
   page, including the recording indicator (`overlay-styles.ts` docstring; `packages/ui/README.md`).
2. Exactly **one `:host` rule**, staying `all: initial !important`; a later normal `:host`
   would silently lose to it. The two isolation attacks in `apps/extension/e2e/run.mjs`
   (`hide it`, `move it off screen`) must keep passing unchanged.
3. Overlay stays a **closed** shadow root, **text nodes only, never `innerHTML`** — every line
   is model output derived from private speech. Consequence: Playwright cannot select anything
   inside the overlay; only the host's computed style and pixels are observable.
4. Overlay host carries **no id** (meeting-site fingerprinting vector) and depends on **no Meet
   selector**.
5. **The capture indicator cannot be dismissed, and collapsing is not a route to it.** Enforced
   by `visibleOverlayPart` / `mayUnmountOverlay` in `apps/extension/src/site-enablement.ts`,
   tested in `site-enablement.spec.ts`. `capturing` vetoes unmount with no override.
6. **Consent replaces the whole popup**, never stacks above the form — stacking is what pushed
   Start past Chrome's 600px cap on first run (`popup/index.html:24-28`, `popup/styles.ts`).
7. **Popup footer stays outside the scrolling region**; `body { width: 320px; max-height: 560px }`,
   three-part flex column. `main.scrolls` is applied by measurement in `main.ts`, so any change to
   `main`'s content height changes when the fade appears.
8. **Settings are not gated on the current tab being a meeting** — a Facebook call runs in a
   toolbar-less window. `Runs on` stays **outside** `<details>`, and `#run-sites` stays built from
   the match patterns in `main.ts` so the list cannot drift.
9. **No UI framework in the extension.** Closed shadow root Tailwind cannot reach; MV3 CSP forbids
   the `eval` a framework build pulls in (`wxt.config.ts`).
10. Overlay `z-index` and font stack stay out of `packages/ui`.
11. `live` vs `speaking` never distinguished by colour alone; every use carries a label, and `live`
    pulses. `live` is ink-on-background, `liveFill` is background-under-white-ink — reversing them
    puts 3.91 contrast on the button that stops a recording.
12. All motion behind `prefers-reduced-motion: reduce`. **One current violation:**
    `audio-source-controls.tsx:86` has `transition-[width] duration-75` with no
    `motion-reduce:transition-none`, while the identical meters at `cascade-panel.tsx:123` and
    `live-panel.tsx:126` have it.

**Technology / ownership**

13. `packages/ui` takes **no dependencies**, hex not oklch, unitless numbers, no DOM code at root
    export. Metro imports it.
14. **`@chatofy/ui` is a `devDependency` of `apps/web`.** No runtime web code may import it — only
    the two specs in `src/design/` do. Web gets tokens by hand-copied CSS custom properties and
    **no codegen**; `token-parity.spec.ts` is the sync mechanism and its mapping table is
    deliberately hand-written.
15. Dark-only, and `@custom-variant dark` stays in `globals.css` so light remains addable.
16. Adding `--text-*` to Tailwind's `@theme` **overrides Tailwind's own utilities of the same
    name**: token `xs` 11 vs Tailwind 12, `sm` 12 vs 14, `base` 14 vs 16, `lg` 22 vs 18, `xl` 28
    vs 20. Naming them `xs…xl` silently re-typesets every existing `text-sm`/`text-xs`/`text-base`/
    `text-lg` in web in one commit. This is why `docs/design-guidelines.md` records the divergence
    as "a change of its own".
17. Changing a **value** in `packages/ui/src/tokens.ts` reaches `apps/mobile/src/ui/theme.ts`,
    which imports it directly. Adding derived CSS in web does not.
18. `pnpm knip` flags unreached exports (`knip.json` covers `apps/web` `app/**` + `src/**`). Any
    primitive added and not used fails the gate.
19. Conventional commits, no AI references; prettier, husky + lint-staged; `pnpm lint typecheck
build test` via turbo.
20. No visual-regression or screenshot tooling anywhere, no Storybook. Playwright is a
    devDependency of **`apps/extension` only**, driven by `apps/extension/e2e/run.mjs`.
21. **CI runs only `lint`, `typecheck`, `test`, `build`** (`.github/workflows/ci.yml:42,65,93,115`)
    — verified. It runs **neither `knip` nor `test:e2e`**. So the file-reading vitest specs below
    are the only acceptance criteria that actually gate; knip and e2e are manual runs.

## 3. NON-GOALS

- **New palette, contrast values, dark-only, or motion policy.** Decided, justified with measured
  ratios, test-enforced. Both problems found are values _missing from web_, not wrong values.
- **Components in `packages/ui`.** Refused with reasons that still hold: web has its own
  primitives, the extension can take none. (Aside: the README's "`apps/mobile` has no screens yet"
  is stale — `apps/mobile/app/` has route files, but they are ~22-line stubs hardcoding
  `#FFFFFF`/`#6E6E73` that never read `src/ui/theme.ts`, so the substance holds. Doc correction,
  not a design change.)
- **`apps/mobile`.** Not named by the user; its screens are stubs.
- **A component library or shadcn registry install.** Excluded on evidence — see Approach C.
- **A light theme.** Deferred by an existing decision; the variant hook stays.
- **Visual-regression baselines / Storybook / a Playwright install in `apps/web`.** Process the
  user did not ask for. The extension's screenshot need is served by extending `e2e/run.mjs`,
  which already opens `popup.html` and already pushes arbitrary `OverlayState` into the content
  script.
- **Deleting `/translate/baseline` or the `POST /translate` path.** It is the stated measurement
  baseline. It gets an honest name and a way back, not a deletion.
- **Removing the mode choice, or shipping only one backend.** Product call (§8). This delivery
  renames and re-weights it; it does not decide it.
- **Changing capture, socket, permission or worker behaviour.** Presentation, IA and copy only.
- **Overlay `errorBox` / `outboundBox` merging.** `renderErrors` deliberately renders one line per
  failing direction because a single line cannot say the meeting is translating fine while nothing
  the user says reaches anyone.

## 4. ACCEPTANCE CRITERIA

**Token-layer conformance (command-checkable)**

1. `globals.css` `:root` declares `--text-secondary: #B4B6C0` and `--border-strong: #35373D`,
   aliased in `@theme inline`, and `token-parity.spec.ts` `MAPPING` covers them.
2. `token-parity.spec.ts` gains a test asserting **every key of `color`** is present in `MAPPING`
   (fails today: `borderStrong`, `textSecondary`). A token added later cannot reach production
   unmapped.
3. `token-parity.spec.ts` gains a `fontSize` mapping and asserts the `@theme` type scale carries
   `11/12/14/17/22/28`.
4. `grep -rn "\[var(--color-" apps/web/app apps/web/src` → 0 hits (today **9**, in 4 files).
5. `grep -rEn "\btext-(xs|sm|base|lg|xl|2xl|3xl)\b|text-\[[0-9]" apps/web/app apps/web/src` → 0
   hits, or every hit appears in an exception table in `docs/design-guidelines.md` with a reason.
   Today: **32** size utilities (17 `text-sm`, 9 `text-xs`, 2 `text-lg`, 2 `text-base`, 1
   `text-xl`, 1 `text-2xl`) plus **3** `text-[Npx]` literals. Role-named utilities used instead
   (§6).
6. `grep -rn "transition-\[" apps/web` → every hit paired with `motion-reduce:` on the same
   element (today `audio-source-controls.tsx:86` is not).
7. No control that ends a session uses `variant="destructive"`; `audio-source-controls.tsx:34`
   uses `variant="live"`.
8. Popup and web resolve to the same family name for body text; `overlay-styles.ts` still sets its
   own explicit system stack and contains no `var(`.

**Structure / IA (reviewer-checkable against a named baseline)**

9. `apps/web/app/page.tsx` contains a `Link href="/translate"` and at least one `className`; it
   renders brand, one value sentence, one primary CTA. (Today: none of the three.)
10. Content width, page padding and vertical rhythm are declared in **exactly one** file;
    `grep -rn "max-w-" apps/web/app/**/page.tsx` → 0 hits (today 2 files, 2 different values —
    `translate/page.tsx:45` `max-w-2xl`, `baseline/page.tsx:41` `max-w-xl`).
11. `baseline/page.tsx` contains a link back to `/translate` (today: none).
12. `<Card>` is used by the panels, or `card.tsx` is removed and the panels' hand-written card
    classes are the single source. Not both: today `cascade-panel.tsx:87` and `live-panel.tsx:81`
    each hand-write `border-border bg-card … rounded-[var(--radius-lg)] border p-6` while `Card`
    is used only by the baseline path.
13. `popup/index.html`: `main#settings > label` count drops from 4 to at most 1 outside a
    subordinated group or `<details>`; `<footer>` stays a direct child of `<body>` after `main`.
14. `overlay.ts`'s `this.panel.append(...)` still lists the indicator before the transcript; the
    transcript is the only element with `flex: 1`/`overflow-y: auto` in the panel; `.controls` no
    longer holds five items in one wrapped row.
15. `git diff` touches neither `src/site-enablement.ts` nor its spec; `overlay.ts` contains no
    dismiss/close handler bound to `.indicator`.

**Copy register (checkable as a closed diff, not an open search)**

16. `grep -rniE "cascade|baseline|barge-in|\becho\b|heard during playback|report timings|end-to-end"
apps/web/app apps/web/src/components apps/extension/entrypoints` returns only occurrences on an
    enumerated exception list, each with a stated reason: none. Today's occurrences to resolve are
    exactly — `mode-toggle.tsx:23,32,38`; `translate/page.tsx:75`; `cascade-panel.tsx:145` (and the
    tooltip at `:143`); `live-panel.tsx:87`; `popup/index.html:82,83,137`; `popup/main.ts`
    `refreshModeNote` (already compliant, kept as the pattern).
17. No user-visible string shows a bare language code. `live-panel.tsx:142-151` renders
    `{live.detectedLanguage}` and `EXPECTED_SOURCE[direction]` (`'vi'`/`'en'`) directly; the
    replacement names the languages.
18. Measurement instruments removed or behind a non-default affordance: `cascade-panel.tsx`
    `echoHeard` counter, `popup/index.html` `#metrics`, `#api`.

**State coverage**

19. A written state list per surface, every entry reachable and reviewed:
    - **Popup:** consent-unseen; meeting tab idle; meeting tab capturing; non-meeting tab;
      Zoom-desktop tab; mic-notice showing; Start disabled by `Runs on` off; `main.scrolls` on/off.
    - **Overlay:** pill idle; pill live; panel idle empty; panel capturing empty; panel with turns
      incl. a `.mine` and a `.live` turn; error bar (each of capture/inbound/outbound); outbound
      `sending`/`muted`/`patched: false`.
    - **Web:** `/`; `/translate` idle; connecting; running with turns; live-panel with source+target;
      error notice; language-mismatch notice; baseline idle/loading/result.
20. The extension half of that list is produced by `e2e/run.mjs` and asserted or screenshotted
    there. Nearly free: the harness already navigates to `chrome-extension://…/popup.html` and
    already contains `renderCapturing(capturing)`, which pushes an arbitrary `OverlayState` into
    the content script. Overlay assertions are pixel-level only (closed root); popup assertions can
    be DOM-level.
21. `pnpm lint && pnpm typecheck && pnpm build && pnpm test` clean (these gate in CI); plus
    `pnpm knip` and `apps/extension` `pnpm test:e2e` green **including both isolation attacks** —
    run manually, since CI runs neither (constraint 21). Extension unit suite is ~10-12 spec files;
    verify the count at execution rather than asserting it.

**What stays a judgement call, honestly:** whether the result is _attractive_ — proportion, rhythm,
whether the landing page is good. Criteria 1-21 pin down consistency, hierarchy inventory, register
and state coverage; they cannot pin down beauty. **How it will be judged:** one review pass by the
user against the fixed screenshot set from criterion 19 — extension shots generated by the harness,
web shots taken by hand from the four routes/states. Accept, or name specific changes per shot.
Named states and a single pass, not an open-ended aesthetic loop. If the user rejects the
_direction_ rather than details, that signals the brainstorm mis-scoped and it belongs back here,
not in another sweep.

## 5. APPROACHES

### A — Complete the token layer and sweep

**Builds:** the two missing tokens; the type scale in `@theme` plus a full utility sweep; one
styling idiom; the motion and `live`-vs-`destructive` drift fixes; a parity spec covering every
token key and `fontSize`. Then the landing page and shell.

**Depends most on:** the ugliness being a plumbing gap — a legible middle text step plus a
consistent scale being most of what "xấu" means.

**Fails first when:** the sweep lands clean, every check in §4's first block is green, and the user
still says "rối". Clutter is six equal controls before the button and backend names in the UI;
nothing in A touches either.

**Worst plausible case:** a mechanical diff across every file in `apps/web`, a stricter test suite,
and no perceived change — because A alone leaves the popup, the overlay control row and every piece
of experiment vocabulary exactly as they are. The next attempt starts from a larger diff and less
credibility.

### B — IA, hierarchy and copy, over a completed token layer

**Builds:** A's two missing tokens and the role-named type scale (prerequisites, cheap,
evidence-backed); then the actual screens — landing page, one shared web shell, a `/translate` where
the primary action and the translation dominate, a popup that is one action plus one subordinated
settings group, an overlay panel where the transcript is the flexible element and the control row is
not five peers; one product glossary replacing backend vocabulary on both surfaces; measurement
instruments retired behind the existing `<details>` or removed.

**Depends most on:** the token layer being sufficient once its two gaps close — that no new colour
or component is needed to draw a hierarchy, only a third text step, a scale, and layout.

**Fails first when:** the mode question is unresolved. `/translate`'s own docstring says "this path
is the product and the live one is the experiment", while the popup offers Mode as a first-class
setting with a helpful note. You cannot lay out `/translate` without knowing whether Live ships to
users, and you cannot rename the baseline link without knowing whether that page is user-facing.

**Worst plausible case:** the IA is built around the wrong product shape — Live is later cut, or
promoted — and the header, the toggle and the popup's second control are redone. The diff is
confined to 4 route files, 8 web components, `popup/index.html`, `popup/styles.ts`, `overlay.ts`,
`overlay-styles.ts`; the token work survives regardless. Reverting is a `git revert` of a bounded
set, and the glossary survives any mode outcome.

### C — Real primitive set / component library

**Builds:** dialog, field/label, select, toast, empty state, skeleton, tooltip, icon-button, nav for
web (registry install or hand-built), plus hand-written CSS parity for the extension.

**Depends most on:** the missing primitives being why it reads unfinished.

**Fails first when:** the extension is reached. It can take **none** of it — closed shadow root
Tailwind does not reach, MV3 CSP forbids the framework build's `eval`, and web's own tokens arrive
as hand-copied CSS with no codegen. The first component needed on both surfaces gets written twice,
by hand, in two idioms.

**Worst plausible case:** web gains ~10 primitives, most unreached — `knip.json` scans `apps/web`
`src/**` and fails the gate, so they get `@public` tags to silence it (the pattern `card.tsx`'s
`CardFooter` already uses today: dead code kept alive by a doc comment). The extension is untouched
and becomes the visibly ugly half. The user complained about web and extension as **one** thing;
C widens exactly that gap while adding a vendored surface to keep in sync.

**Comparison on worst case:** C's is worst — it makes the stated problem worse and adds code the
repo's own tooling rejects. A's is a large no-op diff. B's is bounded rework in files that were
going to change anyway, with the token work surviving.

## 6. RECOMMENDATION

**B, with A's two verified token gaps as its first phase. Not C.**

- The evidence says the gap is above tokens _and_ that two token gaps are real. `borderStrong` and
  `textSecondary` are absent from `globals.css` and uncovered by `token-parity.spec.ts`, while the
  extension renders `textSecondary` in three places. That is why web reads flatter than the
  extension, it is not taste, and it is a two-line CSS change plus a mapping entry. Skipping it
  would mean redesigning hierarchy with two of three text steps unavailable.
- Everything past that is IA, hierarchy and vocabulary, which is B and only B. "Rối" is the popup's
  four equal `<label>` groups before the button, the overlay's five-item control row, and
  `Cascade`/`Live`/`Turn-based baseline`/`heard during playback` on a production surface. No token
  or component fixes those.
- C is ruled out by cited constraint, not preference: `wxt.config.ts` and `packages/ui/README.md`
  mean the extension receives none of it, and `knip.json` means the unused half fails the gate.

**Type scale — deviate from the token key names.** Add role-named entries (`--text-label` 11,
`--text-hint` 12, `--text-body` 14, `--text-translation` 17, `--text-heading` 22, `--text-title` 28),
mapped to `fontSize.xs…xl` by a hand-written table in `token-parity.spec.ts`. Reason:
`--text-xs/sm/base/lg/xl` **override Tailwind's own utilities of the same name** at different values
(11 vs 12, 12 vs 14, 14 vs 16, 22 vs 18, 28 vs 20), so that naming silently re-typesets every
existing utility in web the moment it lands — the exact hazard the guidelines record as "a change of
its own". Role names collide with nothing, make the grep-based criterion 5 enforceable, carry the
meaning the guidelines' own "Role" column already assigns, and follow the hand-written-mapping
convention `token-parity.spec.ts` explicitly defends.

**Cheapest to abandon:** the mode/baseline question is unresolved and only the user can answer it
(§8). B is sequenced so the token, shell, landing, copy-glossary and popup/overlay hierarchy work
all land _before_ anything depends on that answer, and the mode-dependent slice is one commit
against `mode-toggle.tsx`, the `/translate` header, and `popup/index.html`'s `#mode` block.

## 7. SEQUENCING

**Phase 0 — Glossary and state list.** One table: every user-visible string on both surfaces that
names a backend, a measurement or a mechanism, with its replacement; plus the §4.19 state list.
Covers `mode-toggle.tsx`, `translate/page.tsx:75`, `cascade-panel.tsx`, `live-panel.tsx`,
`popup/index.html`, `popup/main.ts`.
**Gate:** the user approves the glossary. It is shared by web and extension, so approving it here is
what stops the two drifting apart again — which is the complaint. Blocks everything else.

**Phase 1 — Token layer completion.** `--text-secondary`, `--border-strong`, role-named type scale
into `globals.css`; `token-parity.spec.ts` gains the every-`color`-key assertion and the `fontSize`
mapping.
**Gate:** `apps/web` `pnpm test` green, and the new every-key test demonstrably fails when a token is
removed from `MAPPING`. No visual change expected yet.

**Phase 2 — Idiom and drift sweep (web).** Arbitrary `[var(--color-*)]` → semantic utilities;
`text-*` → role names; `audio-source-controls.tsx` gets `motion-reduce:transition-none` and
`variant="live"`; `Card` either adopted by the panels or deleted.
**Gate:** §4 criteria 4-7 and 12 pass by grep; `pnpm lint typecheck build test` clean, `pnpm knip`
clean (manual).

**Phases 3 and 4 run in parallel** — disjoint file sets, no shared config, no shared generated
artefact:

**Phase 3 — Web surfaces.** Shell (one file owning width/padding/rhythm), landing page,
`/translate` re-weighted around the primary action and the translation, baseline page renamed per the
glossary with a link back, instruments removed.
**Gate:** §4 criteria 9-11 and 16-18 for web; the web state list from 19 walked by hand and
screenshotted.

**Phase 4 — Extension surfaces.** Popup IA (one control + one subordinated group + `<details>`),
popup adopts the web typeface, `<option>` and `#metrics` copy per the glossary, overlay panel
re-weighted so the transcript is the flexible element and the control row is not five peers.
`e2e/run.mjs` extended to walk the popup and overlay state lists.
**Gate:** §4 criteria 8, 13-18 for the extension; `apps/extension` `pnpm test` and `pnpm test:e2e`
green _including both isolation attacks_; the popup re-checked on first run with consent unseen and
on a non-meeting tab to confirm Start is still above the fold and `main.scrolls` still means what it
looks like.

**Phase 5 — dissolved.** The mode question is answered (§8.1: Live is an experiment, hidden), so the
work it guarded folds into Phases 3 and 4: delete `mode-toggle.tsx` and the `/translate` header
toggle in Phase 3; remove `#mode` and its `refreshModeNote` wiring from the popup in Phase 4. Run
`knip` after the deletion. Phase 4 also carries the build-config prerequisite from §8.4 (bake the
production server URL, since `#api` is being removed).

**Phase 6 — Review pass.** The fixed screenshot set from 19 against the judgement criterion in §4.
**Gate:** user accepts, or names per-shot changes. Docs updated only where behaviour changed:
`docs/design-guidelines.md` (type-scale divergence now closed, exception table, the role-name
rationale) and `packages/ui/README.md` (the stale "mobile has no screens" line).

**Cannot parallelise:** 0 → 1 → 2 → {3,4}. Phase 2's sweep touches the same web files Phase 3
rewrites; running them together merges a mechanical diff into a structural one.

## 8. RISKS AND UNRESOLVED QUESTIONS

**Risks**

- **Popup height regression.** Any IA change alters `main`'s content height, and `main.ts`
  _measures_ it to decide `main.scrolls`. The 600px cap has already been hit once by a stacked
  consent screen. Re-check in the two worst states: consent unseen, and a non-meeting tab where the
  platform list is longest.
- **Overlay panel `max-height`.** Re-weighting `.controls` or the bar stack can push the panel past
  it on a short viewport; `.lines` `overflow-y: auto` absorbs some but not all.
- **Role-named type utilities are a convention with no compiler behind them.** Only the grep in
  §4.5 keeps `text-sm` from reappearing. A repo convention plus a check, not a type error — stated
  honestly rather than claimed as enforcement.
- **The `@theme` collision.** If someone later "tidies" the role names to `xs…xl`, web silently
  re-typesets. The reason belongs in `docs/design-guidelines.md`, not only in a commit message.
- **Overlay verification ceiling.** The closed root means no DOM assertion is possible from
  `e2e/run.mjs` — only host computed style, `elementFromPoint`, and pixels. Overlay state coverage
  is screenshot review, not assertion. Deliberate and non-negotiable (constraint 3).
- **Web state coverage is partly unreachable.** `live.error`, `languageMismatch`, `connecting` and
  `translating` need a backend or a forced value; there is no Playwright in `apps/web` and none is
  being added. Those states get reviewed against a temporarily forced value — said plainly rather
  than implying a harness exists.
- **`knip` and the Card decision.** `card.tsx` already exports `CardFooter` unused, kept alive by a
  `@public` tag. Whichever way criterion 12 resolves, that tag should not be the reason a dead
  export survives.
- **Neither `knip` nor `test:e2e` gates in CI** (constraint 21), so criteria 20-21's non-vitest half
  depends on someone running them.
- **Aesthetics may still be rejected.** Every criterion can pass and the user can still dislike it.
  Mitigated by Phase 0 (glossary approved before any layout) and Phase 6 (fixed shot set), not
  eliminated.

**Resolved by the user (2026-08-19)**

1. **`Live` is an experiment — hide it from the UI.** The mode toggle leaves `/translate`'s header
   and `#mode` leaves the popup; Cascade becomes the single path. This is the largest clutter
   removal available on both surfaces at zero design cost. **Sequencing effect: Phase 5 is no longer
   conditional — it folds into Phases 3 and 4**, and `mode-toggle.tsx` becomes a deletion (check
   `knip` afterwards). B's stated worst case (IA built around the wrong product shape) is thereby
   retired: the shape is now decided before layout.
2. **`/translate/baseline` gets an honest name and a link back**, and stays user-facing. So
   criterion 11 stands as written and the route keeps a product-register name from the Phase 0
   glossary.
3. **`/` is a lean entry point** — brand, one sentence, one primary button into `/translate`,
   sharing the shell. Not a marketing page. Phase 3 scope is the smaller of the two options.
4. **`Server` (`#api`) and `Report timings for measurement` (`#metrics`) do not ship in
   production.** Criterion 18 tightens from "behind a non-default affordance" to "absent from the
   production build", and `<details>Advanced` may disappear entirely — check whether anything else
   remains inside it.

   **Consequence that must be handled, not assumed away:** `apps/extension/src/settings.ts:19`
   defaults `apiBaseUrl` to `http://localhost:3000`, and the `#api` field is the only way to change
   it. Removing the field without changing anything else ships an extension permanently pointed at
   localhost — i.e. non-functional against a real deployment. So this decision carries a
   prerequisite: **the production build must bake in the real server URL** (build-time env var via
   WXT, with the dev build keeping the field or the localhost default). That is a small build-config
   task, not a UI task, and it belongs in Phase 4. Flagged rather than silently absorbed.

**Still open**

5. **Should the popup carry Inter (bundled, ~+40KB in the extension zip) or stay `system-ui`?**
   Unifying two of three surfaces costs bundle size; leaving it costs the visible brand break with
   web. The overlay stays `system-ui` either way (mandated). Not blocking — Phase 4 can land the
   popup IA first and decide the face separately.

---

## Appendix — ultra ranking

Five independent read-only candidates on one immutable evidence packet; one verifier
(strongest tier) scored them anonymized on faithfulness / evidence grounding / criteria
sharpness / honesty about unknowns (1-20 each). Winner materialized unchanged apart from
the citation corrections listed below. No candidate fabricated a citation; no candidate
violated a hard constraint.

| Cand. | Faithful | Grounding | Sharpness | Honesty | Total  |
| ----- | -------- | --------- | --------- | ------- | ------ |
| **B** | 18       | 17        | 19        | 19      | **73** |
| D     | 17       | 19        | 19        | 18      | 73     |
| C     | 17       | 18        | 17        | 17      | 69     |
| E     | 17       | 17        | 17        | 18      | 69     |
| A     | 16       | 17        | 17        | 17      | 67     |

**Winner: B** — the only candidate that found a _causal_ explanation for why web reads
flatter than the extension (`textSecondary`/`borderStrong` missing from `globals.css` and
unguarded by the parity spec), and the only one that both spotted and designed around the
Tailwind `@theme` name-collision hazard that would otherwise silently re-typeset every
existing web utility.

**Runner-up D** tied on points with the most exact citations of the five and two unique
verified findings; it lost the tiebreak because its phase ordering would trigger the
`@theme` collision, and because its CI finding imports into B as a one-line note while the
reverse graft would rewrite D's Phase 1 wholesale. D's CI finding **is** imported here as
constraint 21.

**Corrections applied to the winner** (all substance-preserving; no claim reversed).
Independently re-verified against the tree: popup mode options `index.html:82-83` (was
:73-74) and `#metrics` `:137` (was :135); `heard during playback` `cascade-panel.tsx:145`
(was :129-135); `variant="destructive"` `audio-source-controls.tsx:34` (was :44);
`/translate` h1 `:48`, container `:45` (was :55/:53); language-mismatch notice
`live-panel.tsx:142-151` (was :158-162); hand-rolled cards `cascade-panel.tsx:87` /
`live-panel.tsx:81` (was :83/:87); `textSecondary` `tokens.ts:50` (was :49);
"Turn-based baseline" `translate/page.tsx:75` (was :74); web size-utility count stated as
the measured 32 + 3 literals; extension spec count left to be verified at execution.

**Verifier confidence:** high on the pair ordering {B,D} > {C,E} > A; moderate on the B-vs-D
tiebreak, which was genuinely close and could plausibly swap on a re-run.

**Honest note on the mode itself:** `--ultra` selects the sharpest _contract_, not the
prettiest design. "Is it beautiful" has no ground truth, so it stays the judgement call
named in §4 and gated in Phase 6.
