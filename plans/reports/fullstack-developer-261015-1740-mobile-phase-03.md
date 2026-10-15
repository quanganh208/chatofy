# Phase 3 — Mobile Conference Translation UX

**Status:** DONE
**Branch:** `video-conferencing` (no branch/switch; committed nothing — controller handles commits)
**Date:** 261015-1740 (Asia/Bangkok)

## Outcome

Surfaced the existing Phase 2 translation plumbing in the mobile call view at parity
with web: per-tile subtitle overlay, per-call transcript sheet, source-language
picker, and the `translating…` badge on the local tile. Components + mount only; no
new signaling, no native deps, no hook-signaling changes. All four static gates green.

## Files changed

### Created (owned)

- `apps/mobile/src/components/conference/subtitle-overlay.tsx` — pure readout of a
  tile's current caption. Renders `peer.subtitle`; the hook owns clear-on-final/timeout,
  so a turn whose final never arrives cannot stick (the overlay just disappears when the
  hook sets `subtitle` to undefined). Dark scrim via the `overlay` token + `color.text`
  (the on-dark text token), matching web's white-on-black/80 — theme-independent on
  purpose, same rationale the `overlay` token exists for (translucent over arbitrary video).
- `apps/mobile/src/components/conference/transcript-sheet.tsx` — Modal bottom sheet
  mirroring the Phase 1 `participant-sheet.tsx` pattern (the phase brief said to match
  that pattern; participant-sheet uses `Modal`, not gesture-handler/reanimated, so I
  followed it). Renders a passed `TranscriptEntry[]`, newest last, scrollable, with an
  empty state. Decides nothing about the pipeline.
- `apps/mobile/src/components/conference/language-picker.tsx` — vi/en selector mirroring
  web's lobby `SegmentedControl`. Ghost segments (surface + border, no accent fill).
  Supports a `locked` readout state with an explaining hint.

### Modified (owned)

- `apps/mobile/app/(app)/conference/[roomId].tsx` — mounted picker (top of scroll),
  transcript sheet + its open button, threaded `localTranslating`/`translatingLabel`
  into the grid, and added the `foldTranscript` accumulator (see below). Reads an
  optional `lang` route param for the initial picker value.
- `packages/i18n/src/en.ts` + `vi.ts` — added, in both: `translating`, `sourceLanguage`,
  `sourceLanguageVi`, `sourceLanguageEn`, `sourceLanguageLocked`, `transcript`,
  `showTranscript`, `hideTranscript`, `transcriptEmpty` (all under `mobile.conference.*`).

### Modified (NOT in the task's owned list — justified below)

- `apps/mobile/src/components/conference/participant-tile.tsx` — added optional,
  backward-compatible props `subtitle?`, `translating?`, `translatingLabel?`; renders the
  subtitle overlay and the top-right translating badge inside the tile's existing absolute
  coordinate layer.
- `apps/mobile/src/components/conference/video-grid.tsx` — added optional
  `localTranslating?`/`translatingLabel?`, threads `translating`/`translatingLabel` to the
  local tile and `peer.subtitle` to each remote tile.

**Why these two, which were in the READ-only list:** the task places the subtitle "on the
speaking tile" and the badge "on the local tile" (web parity — web renders both inside its
`video-grid` `VideoTile`). On RN the tiles are a flex-wrap with no stable screen coords a
call-view-level absolute overlay could align to, so true tile placement requires editing
the tile/grid. Consulted the `kongming` agent on the fork: its verdict was Option A (edit
both, all new props optional/backward-compatible) because the file-ownership footnote is a
concurrency guard and these conference phases run strictly sequentially (plan sequencing
table) — zero clobber risk, and the honest implementation. The alternative (a single
call-view-level overlay) would be a deliberate fidelity downgrade. Changes are additive and
optional, so existing callers are unaffected.

## Mid-call language-picker decision

**The hook reads `sourceLanguage` only at `join()`** (it is captured into the
`runJoinSequence` closure and passed to `startTranslateBridge`; there is no mid-call
setter, and the translate direction is derived once at bridge start). Per the task's
explicit allowance, I made the picker **pre-join-only / read-only during a call**:
`languageLocked = status !== 'idle'`. Because the call view auto-joins on mount
(`joinedRef`), `status` leaves `idle` immediately, so in practice the picker is a **locked
readout** of the active language from the first frame, with the `sourceLanguageLocked` hint
explaining why. This is the simplest correct option that touches no signaling: changing the
state after join would not affect the already-started bridge, so allowing edits would be a
lie. The initial value comes from a `lang` route param (`'en'` → en, else vi), so a lobby
that passes `lang` drives it — consistent with how web's lobby owns the choice.

## Transcript accumulation (no hook change)

The hook's `peer.subtitle` is transient (replaced on partial, cleared on final/timeout) and
no `turnId` is exposed publicly, so the call view accumulates. `foldTranscript` keeps a
per-speaker "open entry" (ref): while a caption is non-empty, each new value updates the
same line in place (one turn → one line); when the caption clears, the entry closes so the
speaker's next caption starts a fresh line. The clear event is what delimits a turn. This is
the correct bound achievable without modifying the hook; it can miss a turn only if a final
arrives and clears within a single React batch with no intermediate render (acceptable —
noted as an unresolved question).

## Verification (commands + real results)

| #   | Command                                                             | Result                             |
| --- | ------------------------------------------------------------------- | ---------------------------------- |
| 1   | `pnpm --filter @chatofy/i18n build`                                 | exit 0 — ESM/CJS/DTS build success |
| 2   | `pnpm --filter mobile exec tsc --noEmit`                            | exit 0 — 0 errors                  |
| 3   | `pnpm --filter mobile run lint`                                     | exit 0 — clean                     |
| 4   | `pnpm --filter web exec vitest run src/design/token-parity.spec.ts` | exit 0 — 179 passed                |

i18n build was run BEFORE typecheck so the new `MessageKey`s resolved from built dist.

**Runtime device verification is not possible in this environment** (no emulator/device, no
live stack). The cross-platform subtitle/transcript/direction smoke described in the plan is
manual on the live stack; the four static checks above are the gate and all pass.

## Design-budget compliance

One accent control on the call screen remains **Leave** (`colors.destructive` fill in the
control bar). Picker segments, transcript button/sheet, subtitle overlay, and translating
badge are all ghost/outline/readout — no `colors.primary` fill added. Tokens only; no
hardcoded colors or strings. `token-parity.spec.ts` green.

## Unresolved questions

1. **Picker is effectively a locked readout in the call view** because auto-join fires on
   mount. If an editable pre-join picker is wanted, the natural home is the LOBBY
   (`apps/mobile/app/(app)/conference/index.tsx`, not owned here) passing `lang` through —
   web does exactly this. Should the lobby gain the vi/en picker (a tiny follow-up), or is
   the call-view readout sufficient for the demo?
2. **Transcript can miss a turn** if its final subtitle arrives and the 4 s clear fires
   within one React batch (no intermediate render of the partial). Eliminating this would
   need the hook to expose turn boundaries (a `subtitleKey`/`turnId` on `PeerState`,
   additive) and the view to key on it — out of this phase's "no hook signaling change"
   scope. Acceptable for the demo?
