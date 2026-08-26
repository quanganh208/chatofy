---
title: 'Phase 2: Settings surface and volume'
status: todo
priority: P1
effort: '4h'
dependencies: [1]
---

# Phase 2: Settings surface and volume

## Overview

The visible slice-1 payoff: a settings panel on `/translate` holding direction,
gender and a working volume slider, with `cascade-panel.tsx` reduced to the
conversation itself.

## Requirements

- Functional: settings render as a list of label/control rows; volume attenuates
  playback live, mid-conversation, without restarting the session; direction and
  gender move out of `CascadePanel` into the panel and stay disabled while running.
- Non-functional: one accent per screen (`docs/design-guidelines.md`); **this phase**
  changes nothing in `packages/realtime-client` (phase 4 will — see the note below).

## Architecture

**Layout: a stacked list of label/control rows, not two panes.** The page is a
single column (`AppShell measure="wide"` → `max-w-2xl`), and a split fights the
transcript measure on narrow screens. Group rows with `Separator` under two
headings — _Voice_ and _Playback_. Always visible in this phase (see plan open
questions). The row-list shape is chosen so phases 3-5 each append one row.

**Volume — the seam already exists and must be used as-is.**
`ConversationSessionDeps.createPlaybackSink` is declared at
`conversation-session.ts:64` and preferred over the default construction at `:330`.
`PcmPlaybackQueue`'s third constructor param is `destination: AudioNode =
context.destination` (`pcm-playback-queue.ts:67`). So the web hook supplies:

```ts
createPlaybackSink: (context, onDrained) => {
  const gain = context.createGain(); // FRESH node per invocation
  gain.gain.value = volumeRef.current; // REF, never a captured value
  gain.connect(context.destination);
  gainRef.current = gain;
  return new PcmPlaybackQueue(context, onDrained, gain);
};
```

**Two mandatory details, each from a traced failure:**

1. **The GainNode must be created per factory invocation.** `createAudioContext`
   returns a fresh `AudioContext` per run (`use-streaming-translate.ts:119`) and
   `releaseResources` closes it (`conversation-session.ts:519`). Caching a node
   across runs connects run-2 sources to run-1's context — a cross-context
   `InvalidAccessError`, and audio dies on the second conversation.
2. **The factory must read a ref, not a captured value.** `ConversationSession` is
   constructed once behind `sessionRef.current ??=` (`use-streaming-translate.ts:107`),
   which happens _before_ phase 1's settings load from localStorage. A
   `settings.volume` closed over there is frozen at the first-render default forever,
   and the persisted volume silently never applies. This file already documents the
   identical trap for the auth token — "A READER, not a value" (`:89-93`) — and solves
   it for runtime options with the callback at `:163`. Follow that pattern.

**`useTranslateSettings` must be called EXACTLY ONCE, in `page.tsx`.** It is
per-call-site `useState`, not a global store. A second call site — the panel, or
`CascadePanel` — creates an independent copy: both read storage at mount, then
diverge, so gender changed in the panel never reaches the `start()` that reads the
other copy, and the two debounced writes race into localStorage last-writer-wins.
The failure is silent and presents as "settings randomly don't apply". `settings`,
`set` and the volume getter flow down as props; **no other component may call the
hook.** Signal to watch: a control that visibly changes but whose value never
reaches `conversation.start`.

**Pass a narrow `getVolume: () => number`, not the whole settings reader.**
`useTranslateSettings` already exposes `current()` backed by a ref written
synchronously in `set` (`use-translate-settings.ts:54`), so that is the source of
truth and phase 2 must **not** add a second `volumeRef` — two refs for one value is
a sync bug waiting for an effect-ordering change. But `useStreamingTranslate` has no
business knowing `transcriptLayout` exists, so hand it a stable `useCallback` over
`current` that returns just the volume. Phase 4 needs no equivalent: direction,
gender, speed and `voiceOutput` travel as `start(options)` arguments captured fresh
per click, so volume is the only value that must cross the once-built closure.

**Ref teardown uses `onStopped`, which is web-side.** `releaseResources` is `private`
with no callback (`conversation-session.ts:505`), and the session can stop _itself_
(`onClosed` → `this.stop()`, `:319`), so the hook cannot observe teardown from
outside — an earlier draft of this phase said to null the ref "where the session
releases the context", which is unreachable and would have required editing
`realtime-client`. The correct seam is the existing `onStopped` listener
(`conversation-session.ts:169`, fired at `:494`); the extension already wires it
(`direction-session.ts:182`), the web hook does not. Register it, null `gainRef`
there, and additionally guard `setVolume` on `context.state !== 'closed'`.

**Do not put the GainNode inside `PcmPlaybackQueue`.** The extension's sink feeds
the meeting's _outgoing_ track (`page-playback-sink.ts:5-11`), so a gain stage in
the queue would attenuate what other call participants hear. The queue's own
constructor comment (`pcm-playback-queue.ts:59-67`) states the rule: scheduling is
identical across sinks and `destination` exists to keep it that way.

**Cap gain at 1.0.** Above 1 invites clipping and makes the acoustic loop that
`fullDuplex: true` deliberately accepts (`use-streaming-translate.ts:163-172`)
likelier to close.

**Disabled-while-running set — this phase: direction, gender.** The reason is _not_
"options are sent once": this page opens a fresh server session per turn
(`conversation-session.ts:205-208`), so `client.session.start` carries options every
turn. The real reason is narrower — `ConversationSession` stores the options at
`configure()` (`turn-pipeline.ts:181`) and re-sends that same snapshot per turn
(`:462`), and exposes **no reconfigure API**. Phases 4 and 5 must add their wire
controls to this set for the same reason.

Live (pure client, no wire): volume, and phase 3's transcript layout.

**Slider write path:** `onValueChange` → `set({volume})` **and** a direct
`gain.gain.setTargetAtTime(v, context.currentTime, 0.01)` (click-free). Persisting
on change is safe because `useTranslateSettings` already debounces the write at
200ms with an unmount flush (`use-translate-settings.ts:20`), so a drag collapses to
one `localStorage` write on its own — `onValueCommit` is available but not needed
here.

## Related Code Files

- Create: `apps/web/src/components/translate/translate-settings-panel.tsx`
- Create: `apps/web/src/components/translate/translate-settings-panel.spec.tsx`
- Modify: `apps/web/app/translate/page.tsx` (settings hook replaces `direction` useState)
- Modify: `apps/web/src/components/translate/cascade-panel.tsx` (remove the toggles row)
- Modify: `apps/web/src/hooks/use-streaming-translate.ts` (gain node, `setVolume`, `onStopped`)

## Implementation Steps

1. `useStreamingTranslate`: add `createPlaybackSink` to the deps object per the
   snippet above, plus `volumeRef` kept in sync with settings. Register
   `onStopped: () => { gainRef.current = null; }`. Expose `setVolume(v)` that writes
   the ref always and the node only when one exists and its context is open.
2. Build `TranslateSettingsPanel`: a `Card` with two `Separator`-grouped sections.
   Direction (`DirectionToggle`) and gender (`VoiceGenderToggle`) move here verbatim.
   Volume uses the new `Slider`, labelled, with a percentage readout.
3. `page.tsx`: replace `useState<TranslationDirection>` with `useTranslateSettings()`;
   pass `settings` + `set` down to the panel and `CascadePanel`.
4. `cascade-panel.tsx`: delete the `flex flex-wrap gap-6` toggles row (`:91-94`);
   take `settings` as a prop and pass the relevant fields into
   `conversation.start({...})`. Leave `STATUS_LABEL`/`STATUS_TONE` alone — they are
   explicitly in scope to stay as code.
5. Spec the panel: renders each control; direction/gender disabled while running,
   volume not; changing volume calls through; changing gender persists; volume
   persists on commit rather than on every change.

## Success Criteria

- [x] Settings panel renders on `/translate` as a stacked list
- [x] Volume slider attenuates audio live, mid-conversation
- [x] Volume position survives reload; a drag writes storage once, not per frame
- [x] Volume slider is movable while idle and does not throw after a session ends
- [x] Volume applies on the FIRST conversation after a reload (proves the ref-reader,
      not a captured first-render default)
- [x] Direction and gender disabled while a conversation runs; volume stays live
- [x] Zero diff in `packages/realtime-client` **in this phase**
- [x] `app-skin-guard.spec.ts` passes
- [x] `pnpm typecheck` + `pnpm lint` + `pnpm test` green

## Risk Assessment

- **Stale-closure volume.** Signal: persisted volume never applies on the first
  conversation after reload. Response: the factory must read `volumeRef.current`;
  see Architecture detail 2. This is the single most likely defect in phases 1-2.
- **GainNode outliving its closed context.** Signal: volume throws or silently stops
  working on the second conversation. Response: fresh node per factory invocation,
  `onStopped` nulls the ref, `setVolume` guards on context state. Treat the ref as
  stale-tolerant rather than assuming it is always live.
- **"Zero diff in realtime-client" is a phase-2 claim only.** Phase 4's schema change
  touches a production `SessionOptions` literal at `conversation-session.ts:209-212`.
  Signal: someone cites this criterion to block phase 4. Response: the criterion is
  scoped to this phase by design; phase 4 lists those files explicitly.
- **Panel could grow a second accent-filled control**, against the design direction.
  Signal: design review. Response: the Start button keeps the accent; everything in
  the panel is neutral.
