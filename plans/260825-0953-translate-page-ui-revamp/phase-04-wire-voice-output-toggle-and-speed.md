---
title: 'Phase 4: Wire voice output toggle and speed'
status: todo
priority: P1
effort: '7h'
dependencies: [1, 2]
---

# Phase 4: Wire voice output toggle and speed

## Overview

Two new session options travel the full chain: `voiceOutput` (skip synthesis
entirely) and `speed` (rate, honoured for English output only).

**Sequence within the phase:** `voiceOutput` and its close-path test first (the
risky half), `speed` second. Do not split the phase — both fields ride the identical
schema → gateway → `TurnSession` → pipeline chain, and splitting touches the same
files twice.

## Requirements

- Functional: voice off produces a text-only turn with no audio and no delay; speed
  changes vi→en output rate; both controls are disabled while a conversation runs;
  the speed control is visibly disabled with a caption for en→vi.
- Non-functional: no existing `SessionOptions` construction site is forced to change;
  an out-of-range persisted value must never hang session start.

## Architecture

### The actual trust boundary

`/ws/translate` **is authenticated at upgrade.** `createVerifyClient` refuses a
missing or invalid bearer token with `cb(false, 401)` (`ws-auth.ts:93-113`), wired
onto the `ws` server at `translate.gateway.ts:150`. An earlier draft of this phase
claimed the socket was unauthenticated, inherited from a stale comment.

So the bound on these fields exists for two real reasons, not that one:

1. to contain a **compromised or tampered authenticated client**, and
2. to keep values sane for the **sidecar**, which takes no auth of its own.

**In scope for this phase:** correct the stale "unauthenticated"/"No auth" comments
at `ws-events.ts:43`, `turn-concurrency.ts:37,51`, and `translate.controller.ts:13`.
Adding a fourth copy of a false claim while leaving three standing makes it worse.

### `.optional()`, NOT `.default()`

`SessionOptions` is `z.infer<...>` — the schema's **output** type — where a
`.default()` field is **required** in TypeScript. Proof in existing code:
`voiceGender` is `.default(DEFAULT_VOICE_GENDER)` (`ws-events.ts:27`) and yet every
construction site still passes it explicitly, because it must.

```ts
// packages/types/src/events/ws-events.ts — sessionOptionsSchema
voiceOutput: z.boolean().optional(),
speed: z
  .number()
  .catch(1)
  .transform((value) => Math.min(2, Math.max(0.5, value)))
  .optional(),
```

**Not** `.pipe(z.number().min(0.5).max(2))` — that REJECTS an out-of-range number
instead of pulling it into range, which is the silent hang this section exists to
avoid. `.catch()` alone does not help either: it fires only when the input is not
a number, so `99` sails past it. The arithmetic is the enforcement. (Verified by a
gateway spec that starts a turn with `speed: 99` and asserts it clamps to 2.)

Default them at the single point of use — `TurnSession`'s constructor — so no
existing literal changes. If `.default()` is used instead, `pnpm typecheck` breaks a
**production** literal inside `packages/realtime-client`
(`conversation-session.ts:209-212`) plus the extension's two start-option literals
and four spec literals.

### Clamp, never reject

Both fields land inside `clientSessionStartSchema` (`ws-events.ts:56`). A failed
parse throws `WsException` from `parseWsEvent` (`:30-34`) — and that file's own
comment says `AllExceptionsFilter` **swallows it**, so "a malformed frame is
currently answered with silence" (`:12-19`). A rejected value therefore does not
refuse the turn; it hangs Start forever with no error and no recovery a user could
guess, and phase 1 persists these values client-side.

Clamp with `.catch()` as above. This also matches established doctrine here: the
sidecar deliberately does not 422 an unrecognised gender (`app.py:51-54`), and D8
records the same rule — "API là public nên phải chịu được input lạ"
(`development-journey.md:245`). If a refusal is ever genuinely needed, it must be
**emitted as a contract event** the way the mode-conflict path does
(`translate.gateway.ts:202-211`), never thrown.

### Voice-off skip point

Guard inside `streamClauses` (`translation-session.service.ts:461`) — but **after** a
`registry.holds` check, not before it. `holds` is the first statement _inside_ the
loop body (`:470-475`, "Checked every iteration"), so returning at the very top skips
the only in-turn client-liveness check: an abandoned voice-off turn would report
`stoppedBy: undefined` → `record(true, …)` → filed as `completed` on a socket nobody
holds (`:310-319`).

Return a **distinct close reason** (`'voice_off'`), not a bare empty delivery.
Without it the server writes a metrics row with `completed: true` and
`firstAudioAtMs === translatedAtMs`, because `TurnTimeline.toMetrics` falls
`firstAudioAt` back to `translatedAt` (`turn-timeline.ts:83,100`) — indistinguishable
from a turn where TTS returned in zero milliseconds, silently deflating every
time-to-first-audio percentile. On the client, `outcomeFor` maps `completed` +
unheard to `no_audio` (`conversation-session.ts:695`), conflating user intent with
pipeline failure; a distinct reason lets both sides tell them apart.

`transcript.final` has already been sent by the time the guard runs, so the client
still gets its text.

### Speed is English-only and must say so

`vieneu_vi.py:33` ignores `speed` outright; `kokoro_en.py:52` passes it to
sherpa-onnx. The control is enabled when the _output_ language is English (direction
`vi_to_en`) and disabled with a caption otherwise. `SegmentedControl` already
supports `disabled` and `hint` (`segmented-control.tsx:44,48`).

**Preset range — decide before implementing.** Sub-1.0 speeds manufacture dropped
sentences deterministically on this page, not occasionally:

- capture is continuous with an 8s per-turn ceiling (`use-streaming-translate.ts:38`),
  so a turn arrives at least every 8s;
- at 0.75× Kokoro stretches output by 1/0.75 ≈ 1.33×, so an ~8s translation plays
  ~10.7s — utilisation passes 100% permanently and the backlog is monotonic;
- after ~4-5 consecutive turns `backlogMs` crosses `MAX_BACKLOG_MS = 12_000`
  (`ordered-playback.ts:71`) and `enforceBacklog` drops the oldest waiting turn on
  every subsequent frame (`:447-461`);
- `backlogMs` deliberately excludes the head's sounding remainder (`:254-260`,
  `:344-345`), and that excluded remainder is itself 33% larger at 0.75× — so the
  ceiling under-measures exactly when it matters most;
- the only trace is a `console.warn` (`use-streaming-translate.ts:161`), while the
  live line vanishes via `transcript.turnAbandoned`.

The user would select "slower speech" and get roughly every fifth sentence silently
never spoken. **Default: ship presets ≥ 1.0 (1× / 1.25× / 1.5×).** Sub-1.0 may only
ship together with a visible dropped-sentence marker in the transcript.

### Sidecar bound

`SynthesizeRequest.speed` is a bare `float` with no constraint (`app.py:55`) while
`gender` two lines above has documented defensive reasoning. The sidecar takes no
auth and serializes all synthesis behind one lock (`base.py:97-100`), so it is the
resource that needs the bound most. `speed: 0.001` asks Kokoro for ~1000× the audio
for one clause while holding the lock; `speed: 0` is undefined behaviour. Add
`speed: float = Field(1.0, ge=0.5, le=2.0)` **in this phase** — validate at the
boundary that owns the resource, not only the one furthest from it.

### HTTP parity — decide, do not defer

`translateRequestSchema` (`packages/types/src/http/translate.ts:24`) is a second
public surface with the same deploy-skew constraint. **Decision: add `voiceOutput`
and `speed` there too, `.optional()`, with the same clamp.** Leaving them off makes
the two surfaces diverge silently; adding them unbounded would make the sidecar bound
above load-bearing for an authenticated HTTP caller.

## Related Code Files

- Modify: `packages/types/src/events/ws-events.ts` (+ correct the stale comment at `:43`)
- Modify: `packages/types/src/http/translate.ts`
- Modify: `apps/api/src/modules/translate/translate.gateway.ts`
- Modify: `apps/api/src/modules/translate/translate.controller.ts` (+ stale "No auth" comment)
- Modify: `apps/api/src/modules/translate/session/turn-concurrency.ts` (stale comments `:37,51`)
- Modify: `apps/api/src/modules/translate/session/turn-session.ts` (defaults live here)
- Modify: `apps/api/src/modules/translate/services/translation-session.service.ts`
- Modify: `apps/api/src/modules/translate/services/pipeline-translator.service.ts`
- Modify: `packages/ai-providers/src/interfaces/tts-provider.ts`
- Modify: `packages/ai-providers/src/providers/local-speech/local-speech-tts-provider.ts`
- Modify: `services/local-tts/app.py` (bound `speed`)
- Modify: `apps/web/src/components/translate/translate-settings-panel.tsx`
- Modify: `apps/web/src/components/translate/cascade-panel.tsx`
- Modify: `apps/api/src/modules/translate/translate.gateway.spec.ts`
- Create: `packages/realtime-client` `OrderedPlayback` spec case (client half of the close test)
- Modify: `services/local-tts/test_app.py` (speed bounds)

## Implementation Steps

1. Extend `sessionOptionsSchema` with `voiceOutput` and `speed`, both `.optional()`
   with clamping `.catch()`. Mirror onto `translateRequestSchema`. Correct the four
   stale auth comments.
2. Default both in `TurnSession`'s constructor; carry through gateway → pipeline
   following `voiceGender`'s existing path.
3. Add optional `speed?` to `TtsSynthesizeRequest`; the local provider adds it to the
   POST body only when present. Document that ElevenLabs ignores it, as it already
   documents ignoring `voiceGender`.
4. Bound `speed` in `services/local-tts/app.py` with `Field(ge=0.5, le=2.0)`; add a
   pytest for out-of-range rejection.
5. Guard `streamClauses` after the `holds` check, returning `stoppedBy: 'voice_off'`.
   Map that reason through `record`/`close` and the client's `outcomeFor` so metrics
   distinguish it from `no_audio`.
6. Add the `Switch` (voice output) and speed `SegmentedControl` to the settings panel.
   **Both `disabled={running}`** — they ride `client.session.start` and
   `ConversationSession` exposes no reconfigure API. Speed additionally disabled +
   captioned when direction is `en_to_vi`.
7. Tests, split across the two runtimes the claim spans:
   - api: a payload omitting both fields still works (compatibility); an out-of-range
     speed is **clamped, not rejected**, and the session starts; a `voiceOutput:false`
     turn emits `server.transcript.final` and `server.session.ended` with **zero**
     `server.audio.frame`, and closes with the `voice_off` reason.
   - `packages/realtime-client`: an `OrderedPlayback` spec using the injected clock
     (`ordered-playback.ts:149-154`) asserting `open → finish` with no `push` retires
     the turn and releases the next head without advancing time. This is the half that
     proves "does not wait `TURN_STALL_TIMEOUT_MS`" — that constant is module-private
     to this package (`:59`) and unreachable from an api spec.
8. Manual listen at 1.25× and 1.5× on vi→en to confirm Kokoro's time-scaling is
   artifact-free.

## Success Criteria

- [x] Voice off → no audio, transcript arrives, turn closes with reason `voice_off`
- [x] Voice-off turns are distinguishable from pipeline failure in both server metrics
      and client outcome
- [x] An abandoned voice-off turn is still filed as abandoned, not completed
- [x] Speed audibly changes vi→en output
- [x] Speed control disabled with a caption for en→vi — never silently inert
- [x] Voice-output and speed controls disabled while running — never silently inert
- [x] Out-of-range speed is **clamped and the session starts** (never a silent hang)
- [x] A client sending neither field still works; no existing `SessionOptions` literal changed
- [x] Sidecar rejects out-of-range speed at its own boundary
- [x] Client-half close test lives in `packages/realtime-client` with an injected clock
- [x] Extension source unchanged
- [x] `pnpm typecheck` + `pnpm lint` + `pnpm test` + api e2e + sidecar pytest green

## Rollback

This phase mutates `packages/types`, which three apps compile against. A revert is
**not** a no-op: any web or extension code still passing the new fields would then be
passing excess properties. Revert order is `apps/web` → `apps/api` → `packages/types`,
and `.optional()` (rather than `.default()`) is what keeps a partial revert compiling.
Deploy order is `apps/api` before `apps/web`, since the server tolerates the fields'
absence but a new client assumes the server understands them.

## Risk Assessment

- **`.default()` used out of habit.** Signal: typecheck fails in `realtime-client` or
  `apps/extension`. Response: switch to `.optional()` + default in `TurnSession` — do
  not "fix" it by editing the literals.
- **Slow-speed drop cascade.** Signal: raised `onTurnAbandoned` counts, users
  reporting missing sentences at slow speeds. Response: presets are ≥1.0 by default;
  sub-1.0 requires the visible marker first.
- **Contrast of the disabled speed control is NOT covered by `contrast-floors.spec.ts`.**
  That spec measures a hardcoded list of palette token pairs (`:33-53`) and never
  renders a component, so it cannot fail for this. Response: express the disabled
  state with a token pair (`textMuted` on `surfaceRaised`) so an existing row covers
  it, or add the concrete pair to `PAIRS` in this phase. `app-skin-guard.spec.ts` is
  the spec that actually walks components.
  **The caption is where this binds, not the control.** WCAG 1.4.3 exempts disabled
  controls from contrast minimums, so the `SegmentedControl` itself may dim like every
  other disabled control in the kit. The caption explaining _why_ it is disabled is
  not disabled content — it must be full opacity, on a measured token pair, and never
  nested inside an `opacity-50` wrapper, because opacities multiply. See the
  finding-16 adjudication in `plan.md`.
- **Placebo controls under ElevenLabs.** It already ignores `voiceGender` and will
  ignore `speed`. Signal: `AI_TTS_PROVIDER=elevenlabs` in any environment. Response:
  document now; phase 5's catalog endpoint becomes the capability signal the UI keys off.
