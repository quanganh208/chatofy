---
phase: 1
title: 'Overlay style isolation hardening'
status: pending
priority: P1
effort: '3h'
dependencies: []
---

# Phase 1: Overlay style isolation hardening

## Overview

Close two ways a meeting page can defeat the overlay's documented invariants,
and fix a live defect that makes one of those invariants false in the opposite
direction. Ships as its own PR, merged on its own schedule — it must not wait
for the design work. It is sequenced first only because it edits the same
`STYLE` and host code phase 6 rewrites.

## Requirements

- Functional: a page-authored stylesheet cannot hide, move, or transform the capture indicator; the indicator and the error bar hide when the code says to hide them.
- Non-functional: zero change to the style delivery mechanism (`style.textContent = STYLE` stays), zero CSP delta, existing unit + e2e suites still pass.

## Architecture

Three defects, all verified in the current file.

**1. `[hidden]` does not work on two elements — a live bug.** `STYLE` declares
`.indicator { display: flex }` (`content/index.ts:49`) and
`.error { display: flex }` (`:71`), and the file contains no `[hidden]` rule at
all. An author-origin `display: flex` beats the UA-origin
`[hidden] { display: none }` unconditionally. The code hides both by property —
`this.indicator.hidden = !state.capturing` (`:314`),
`this.errorBox.hidden = failures.length === 0` (`:337`) — so **the capture
indicator never hides and the error bar renders as a permanent empty amber
strip**. `.outbound` (`:319`) and `.hint` (`:348`) declare no `display` and hide
correctly, which is why this is a targeted defect rather than a misreading.

The file's own header claims the indicator "is shown for exactly as long as
capture is running". That is true in the under-showing direction and false in
the over-showing one, and it makes the overlay unable to express an idle state —
which phase 5 and phase 6 both assume it can.

**2. The host element is targetable by id.** `HOST_ID = 'chatofy-overlay-host'`
is assigned at `:205` and **never read** — `git grep` finds it only at its
declaration (`:27`) and that assignment; the only other hits are under the
gitignored `apps/extension/.output/`. It is a fixed, guessable selector handed
to the page for free.

**3. Outer-tree normal declarations beat `:host`.** Per CSS Scoping cascade
ordering, when declarations come from different tree contexts the outer tree
wins for normal declarations; only `!important` reverses that in favour of the
shadow tree. The file contains no `!important` anywhere.

Honest framing: `all: initial !important` is the fix. Deleting the id is
defence-in-depth — the important reset already beats
`#chatofy-overlay-host { display: none !important }` from the page. Do not sell
them as two halves of one thing.

The blanket form matters more than the obvious properties suggest. It also
closes `transform`, `filter`, `clip-path`, `contain` and `content-visibility` on
the host — and a page-authored `transform` on the host would re-anchor the
`position: fixed` panel to it and let the page drag the overlay off-screen
without ever touching `display`. That is the best argument for `all` rather than
an enumerated list.

**Accepted residual risk:** the page can set `transform` on `html` or `body`
itself, which re-anchors the fixed panel from outside the shadow tree entirely.
Nothing in the shadow sheet reaches that. Named, not fixed.

Note for phase 6: `all: initial` does **not** reset custom properties, with or
without `!important`. They pierce the shadow boundary as a deliberate public
styling interface. That is why phase 6 interpolates literal values instead of
emitting CSS variables — the two decisions are the same decision.

## Related Code Files

- Modify: `apps/extension/entrypoints/content/index.ts` — `[hidden]` rule, remove `HOST_ID`, harden `:host`, extend the header comment
- Modify: `apps/extension/e2e/run.mjs` — the hostile-stylesheet assertion

## Implementation Steps

1. **Confirm the `[hidden]` bug by eye first.** No test covers the overlay DOM. Build, load unpacked, start capture, stop it, and watch whether the indicator disappears and whether an empty amber strip is present. Thirty seconds, and it decides whether step 2 is a fix or a no-op.
2. Append `[hidden] { display: none !important; }` to the end of `STYLE`, matching the rule `entrypoints/popup/index.html:57` already carries for the same reason.
3. Delete the `HOST_ID` constant and the `host.id = HOST_ID` assignment. Nothing reads it; the host is appended to `document.body` directly at `:298` and held in the closure that owns it.
4. Change `:host { all: initial; }` to `:host { all: initial !important; }`. Do **not** add an enumerated `display/visibility/opacity/position/pointer-events !important` list — `all: initial !important` already sets every one of them with importance, so the list is pure redundancy. If it is kept at all, keep it as a comment naming what is covered.
5. Verify the host still renders. `all: initial` already resolves the host to `display: inline` today and the fixed-position `.panel` inside is what draws, so the reset is a no-op on layout — but confirm visually rather than trusting the reasoning.
6. Extend the file's header comment with a fourth numbered decision: why the host carries no id, why the reset is `!important`, and the `transform` re-anchoring attack that motivates the blanket form. Match the existing prose style — the reason, not the rule.
7. Write the e2e assertion in `apps/extension/e2e/run.mjs` (see below), **run it against `main` first, and paste the failure output into the PR body**. An assertion that has never been red proves nothing here.

### The e2e assertion — the naive version does not work

The shadow root is `closed` (`:207`). Playwright's selector engine pierces
**open** roots only, so `.indicator` is unreachable from the harness and its
`boundingBox()` cannot be read. The obvious fallback fails too: with
`all: initial` the host is `display: inline` and its only child is
`position: fixed`, so `host.getBoundingClientRect()` is **0×0 on a healthy
build** — "assert non-zero bounding box" fails green.

What to do instead:

- **Find the host from page script**, since deleting the id removes the handle: filter `document.body.children` to `DIV` elements with `childElementCount === 0 && !textContent` — a closed root is invisible from the page, so the overlay host looks empty. On the current harness page (`e2e/run.mjs`, `MEETING_HTML`) it is the only such element. **Assert exactly one match**, so a future change to the harness markup fails loudly instead of testing the wrong node.
- **Assert computed style on the host**, which lives in the document tree and is readable from the page: after injecting a hostile sheet targeting `div[id]`, `body > div`, and `#chatofy-overlay-host`, require `display !== 'none'`, `visibility === 'visible'`, `opacity === '1'`, `position === 'static'`, and `transform === 'none'`.

## Success Criteria

- [x] `git grep chatofy-overlay-host` returns nothing (use `git grep`, not a filesystem grep — a stale `.output/` will otherwise fail it; rebuild before checking either way)
- [x] `:host` reset carries `!important`
- [x] `STYLE` ends with a `[hidden]` rule; the indicator hides on stop and no empty error strip is drawn
- [x] The new e2e assertion was confirmed red against `main`, with the output in the PR body, and is green after
- [x] `pnpm --filter extension test` passes
- [x] `pnpm --filter extension test:e2e` passes
- [x] Overlay renders identically otherwise — this phase changes no colour, size, or layout

## What actually shipped, and how it differs from the above

Three things were wrong in the plan and were corrected during implementation.
Recorded here rather than edited away, because each was found by a check the
plan itself demanded.

**The scope grew onto the capture path, deliberately and with approval.** Making
`hidden` work turned a fail-safe bug into a fail-open one: the indicator was
previously stuck visible, and once the property took effect it followed
`publisher.state.capturing` — which does not survive an MV3 worker restart.
`background.ts` restores `patch` and `activeTabId` from `storage.session` and
nothing else; `OverlayPublisher` starts at `capturing: false`; the offscreen
document holds the audio graph and outlives the worker; and there was no way to
ask it. A quiet meeting is enough for Chrome to end the worker, and the next
republish would take the recording indicator down mid-recording. Fixed properly:
a new `{ to: 'offscreen', type: 'status.query' }` message, handled **before** the
listener's fall-through (which treats every unnamed message as a stop, so asking
would otherwise have ended the capture), sent on worker start only when an
offscreen document already exists. The `query` handler now also answers a
non-captured tab with `OverlayPublisher.blank()` — one publisher state was being
handed to every asker, telling a second meeting it was being recorded.

**The `transform` assertion in the first draft was vacuous.** Its red run
reported `transform: "none"`, identical to the green expectation: once
`display: none` wins the host has no layout box and Chromium resolves `transform`
to `none` regardless. And a bare transform does not work against the unhardened
code either — `all: initial` leaves the host `display: inline`, where transforms
do not apply. The real vector needs `display: block !important` **paired** with
the transform, which makes the host a containing block for the fixed panel. It is
now a second, separate attack, and its red run reads
`{"display":"block","transform":"matrix(1, 0, 0, 1, 0, 9999)","hitIsHost":false}`.
The two attacks must stay separate: run together, the first masks the second.

**"Confirm by eye" was replaced with a measurement.** The cascade was proved in
real Chromium inside a closed shadow root — `.indicator{display:flex}` + `hidden`
computed to `flex`, `.outbound` (no display rule) + `hidden` computed to `none`,
and `none` after the fix.

Also corrected: the constructor now sets `indicator.hidden = true`, matching the
two boxes beside it — `render()` only runs once the worker answers, so the
indicator announced a recording on every meeting page before any state existed.

**A second review round hardened the recovery.** Asking the offscreen document
was best-effort: one unretried message, and several paths publish
`capturing: false` inside the window before the answer lands — including
`refreshSettingsHint`'s own error path, which runs inside the restore itself.
The fix is to make _not knowing_ a state. `OverlayPublisher.markCaptureUnknown()`
is set synchronously at worker start, before anything is awaited (marking after
the `await` would let the reply set the flag it was meant to clear), and while it
holds, any publish that would render `capturing: false` is suppressed — the state
is still stored, so the next authoritative push is built on top of it.
`applyStatus` clears it; `clearCaptureUnknown()` covers the case where there was
no document to ask, which is itself the answer. That turns every remaining path
back to fail-safe.

Two more from the same round: the offscreen listener no longer treats unknown
messages as a stop (`end` is now named, and anything else ignored — the
fall-through meant any future message type could silently kill a live capture),
and the `ACTIVE_TAB_KEY` write is awaited rather than fired off, since losing the
worker in that window leaves a running capture with no render target.

The two new rules live in `src/` rather than `entrypoints/` —
`OffscreenHost.requestStatus()` and the publisher's unknown-state suppression —
following the rule `background.ts` states about itself: `entrypoints/` is not
covered by the unit suite, and these are exactly the rules that fail silently.
Nine unit tests now cover them.

Still uncovered end to end: nothing kills the service worker in the e2e run, so
the recovery round trip itself is only exercised by unit tests.

Known and not fixed, now recorded in the e2e footer: a page can still hide the
overlay from **outside** the shadow tree (`body { display: none }`,
`body { content-visibility: hidden }`, a `filter` on `html` — the last leaves it
invisible while still passing the hit test). Nothing inside a shadow sheet can
reach an ancestor. And `test:e2e` is not in CI, so these checks guard nothing
unless someone runs them.

## Risk Assessment

- **`all: initial !important` clobbers a host inline style or a later `:host` rule.** Verified absent today: there is no `host.style.*` anywhere in the constructor and exactly one `:host` rule in `STYLE`. Signal: overlay disappears or mispositions in the e2e run. Response: find the `:host` or inline style being clobbered and fix that. Do **not** fall back to an enumerated property list — that reopens `transform`, `filter`, `clip-path` and `content-visibility`, which is a downgrade dressed as a mitigation.
- **The `[hidden]` fix turns out to be a no-op** because something else already masks it. Signal: step 1's visual check shows the indicator hiding correctly today. Response: drop step 2 and say so; do not add a rule that fixes nothing.
- **The e2e assertion passes for the wrong reason.** Signal: it is also green on `main`. Response: step 7's ordering is the guard and is not optional.
- **Scope objection.** This is a security and correctness fix inside a design plan. It is independently revertable, reviewed as its own PR, and its merge does not depend on any later phase existing.
