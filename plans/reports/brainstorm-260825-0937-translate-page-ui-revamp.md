# Brainstorm — /translate page UI revamp + output voice settings

Date: 2026-08-25 · Branch: `feat/translate-page-ui-revamp` · Advisor: kongming (`--advice`)

## Request

> Hiện tại phần UI trang translate chưa ổn lắm, đang hardcode khá nhiều. Tôi muốn
> user có thể chọn bật tắt voice đầu ra, có thể chọn giới tính, chọn voice, chọn
> volume, chọn tốc độ nói. Thêm setting ở trang đấy hiển thị UI chia làm 2 bên
> hoặc theo list

User clarified in session: "chia 2 bên / theo list" = **transcript** reading
layout (source|translation two-column vs current stacked list), and it must be a
**runtime user setting that persists**, not a design choice made once.

## Contract

**Outcome.** `/translate` gets a persistent settings surface. User controls six
things: output voice on/off, voice gender, specific voice, playback volume,
speaking rate, transcript layout. Choices survive reload. Nothing about the
speaking experience stays hardcoded in `cascade-panel.tsx`.

**Constraints.**

- ~~Wire contract is public + unauthenticated at upgrade.~~ **Corrected 2026-08-25
  after red-team review:** `/ws/translate` **is** authenticated at upgrade —
  `createVerifyClient` refuses a missing or bad token with `cb(false, 401)`
  (`ws-auth.ts:93-113`), wired at `translate.gateway.ts:150`. This line inherited a
  stale in-code comment (`ws-events.ts:43`). The bound on new fields still stands, for
  the real reasons: containing a compromised _authenticated_ client, and keeping
  values sane for the sidecar, which takes no auth of its own. Every new field bounded
  and **`.optional()`** (not `.default()` — that is required in `z.infer`'s output
  type) — `apps/web` and `apps/api` do not deploy atomically (`ws-events.ts:48-55`),
  and `apps/extension` shares `SessionOptions`.
- TTS backends share no voice vocabulary. Selecting a voice already broke prod
  once: web sent a VieNeu preset name as `voice`, ElevenLabs interpolated it into
  the request path → 404 → 503 on **every** Vietnamese turn
  (`docs/development-journey.md:356-359`). Unknown voice must fall back, never fail.
- VieNeu ignores `speed` (`services/local-tts/engines/vieneu_vi.py:33`). Kokoro
  honours it (`kokoro_en.py:52`). Speed is therefore English-output-only.
- Design: accent once per screen, hierarchy by size/weight/space, surfaces by
  depth (`docs/design-guidelines.md`). `contrast-floors.spec.ts` polices new controls.
- `packages/ui` has no Slider, no Switch. Kit is `radix-ui` — both are thin skins.
- `apps/web` has no preference store except theme.

**Non-goals.**

- Cross-device sync. No Prisma `User` settings column, no settings API. Nothing
  in the request implies it.
- Changing `realtime-client` scheduling, ordering, backlog or stall-watchdog logic.
- i18n / externalising `STATUS_LABEL` copy maps. See open question 1.
- Reviving `/translate/live` or `/translate/baseline` in the product surface.

**Acceptance.**

1. Voice off → server synthesizes nothing for the turn; transcript still arrives;
   turn closes without waiting out `TURN_STALL_TIMEOUT_MS` (15s). Covered by test.
2. Volume slider attenuates live, mid-conversation, without restarting the session.
3. Speed 0.75×/1.5× audibly changes vi→en output; control is disabled with a
   caption for en→vi rather than silently doing nothing.
4. Voice picker lists only voices the running backend actually reports; a stale
   persisted voice token degrades to gender rather than erroring the turn.
5. Transcript switches two-column ↔ list; choice survives reload.
6. All settings persist across reload; a corrupt/stale stored value falls back to
   defaults instead of breaking the page.
7. `pnpm typecheck`, `pnpm lint`, `pnpm test` green; contrast floors pass.

## Current state (verified)

| Knob   | Backend reality                                                                                                                                                       |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On/off | Nothing anywhere. `streamClauses` (`translation-session.service.ts:461`) is the seam                                                                                  |
| Gender | Works end-to-end: `sessionOptionsSchema` → gateway → `TurnSession:55` → sidecar                                                                                       |
| Voice  | Kokoro = 53 int sids, VieNeu = 20 preset names. No name list exposed by sherpa-onnx; existing labels are audition results. `models/` empty in repo (runtime download) |
| Volume | `PcmPlaybackQueue` → `context.destination`. `destination` param exists (`:67`), `createPlaybackSink` dep seam exists (`conversation-session.ts:329-331`)              |
| Speed  | Sidecar accepts it (`app.py:55`); provider never sends it; VieNeu ignores it                                                                                          |
| Layout | `conversation-transcript.tsx` stacks source above translation, left rule per turn                                                                                     |

UI today: `cascade-panel.tsx` is 128 lines holding prose copy, Start/End, both
toggles, status indicator, mic meter, error alert and the transcript.

## Recommendation — three slices

**Slice 1 — client only. No wire change, no server change.**
Settings surface on `/translate` as a **list** of label/control rows (not two-pane:
the page is single-column, and a split fights the transcript measure and small
screens). Move `DirectionToggle` + `VoiceGenderToggle` into it. Add volume slider
and transcript layout toggle. Persist all of it.

- Volume: web supplies `createPlaybackSink` (`conversation-session.ts:64`, preferred
  at `:330`) returning `new PcmPlaybackQueue(context, onDrained, gain)` where
  `gain = context.createGain()` → `context.destination`. **Zero changes to
  realtime-client.** Slider writes `gain.gain.setTargetAtTime(...)` — click-free,
  live mid-session. Capped at 1.0: above 1 invites clipping and makes the acoustic
  loop `fullDuplex: true` accepts (`use-streaming-translate.ts:163-172`) likelier
  to close.
- **Do NOT put the GainNode inside `PcmPlaybackQueue`.** Verified: the extension's
  sink feeds the _meeting's outgoing track_, not this machine's output
  (`page-playback-sink.ts:5-11`). A gain stage in the queue would attenuate what
  the OTHER participants hear — a different feature, and arguably a defect.
  `pcm-playback-queue.ts:59-67` states the rule: scheduling is identical across
  sinks, and the `destination` param exists to keep it that way.
- Transcript layout: `layout` prop on `ConversationTranscript`. Two-column renders
  each turn as a source|translation grid row, keeping the deliberate hierarchy —
  translation stays the larger `text-translation` (`conversation-transcript.tsx:24-27`).
  **Must collapse to stacked below ~`sm`** — two prose columns don't fit a phone;
  automatic, not a broken state. Live turns keep today's provisional italic styling,
  source left / translation right.
- Picker for layout + speed uses existing `SegmentedControl` / `ToggleGroup`. Only
  `Switch` and `Slider` are new.
- Disabled while running (matches `DirectionToggle`, `cascade-panel.tsx:92`):
  direction, gender, voice, speed, voice on/off — all ride `client.session.start`.
  Live: volume and transcript layout, both pure client.
- Persistence: localStorage key `chatofy.translate-settings`, mirroring
  `apps/extension/src/settings.ts` — merge over defaults, zod-validate on read,
  whitelist stale values. Load in an effect / mounted gate, **not** a `useState`
  initializer (app-router hydration mismatch). No inline script needed; settings
  don't affect first paint.
- Add `Switch` + `Slider` to `packages/ui/src/react/` as radix skins.
- Cheapest to abandon; delivers real value alone.

**Slice 2 — wire flags.** `voiceOutput: boolean` and bounded `speed` on
`sessionOptionsSchema`, both defaulted.

- On/off as a **wire flag, not client mute**: sidecar engines serialize inference
  on shared CPU, and sidecar contention is the documented cause of mid-turn
  starvation (`pcm-playback-queue.ts:14-22`). Client mute pays full synthesis cost
  to throw the audio away. Text-only is genuinely faster, not just quieter. The
  loop's own comment makes the same argument — it already bails rather than
  "synthesizing clauses nobody will hear" (`translation-session.service.ts:472-474`).
- Skip point: guard at the top of `streamClauses`, returning the delivery before
  entering the synthesis loop. `transcript.final` has already gone out; the turn
  close path is unchanged and every client close path reaches `ordered.finish`
  (`conversation-session.ts:357-359`).
- Path: schema → gateway → `TurnSession` → `pipeline-translator` → optional
  `speed?` on `TtsSynthesizeRequest` → local provider POST body.
- Speed UI: `SegmentedControl` presets 0.75/1/1.25/1.5, disabled + captioned when
  output language is Vietnamese. Direction already flips it, so the state reads as
  a consequence, not a mystery.
- Mid-session soft mute comes free from volume 0, so start-time-only costs little.

**Slice 3 — voice catalog.** Opaque `voice?: string.max(64)`, absent/unknown →
falls back to gender.

- Optional `listVoices?(language)` on `TtsProvider`; local provider proxies a new
  sidecar `GET /voices`; each engine extends its existing `VOICES` ClassVar
  (`base.py`) to a curated `{token, label, gender}` list. API exposes it; UI hides
  the picker when empty.
- **The catalog cannot be generated — it must be hand-audited.** Kokoro's 53 sids
  are bare ints with no name list from sherpa-onnx, models are runtime-downloaded
  (`models/` empty in repo), and today's gender labels are audition results
  (`kokoro_en.py:20-23`, `vieneu_vi.py:11-14`). So "chọn voice" ships as ~3-4
  auditioned voices per gender per language with invented labels, **not all 53**.
  Someone must listen to candidates — that audition is product work, and it is the
  natural cut line if scope pressure hits.
- **Hard provider rule to write into the contract doc comment:** a provider must
  never pass a client-supplied voice token into a request path or param unless it
  recognises the token against its own catalog. The API resolves via `listVoices`
  first, but the provider-level fallback is the defense that survives the next
  refactor — it is literally what fixed the last outage. Prior art for exactly this
  contract: D8, invalid `LOCAL_TTS_VOICE_ID` → fallback, justified as "API là public
  nên phải chịu được input lạ" (`development-journey.md:245`).
- ElevenLabs doesn't implement it → empty → gender only. No worse than today.
- **Reject a static manifest in `@chatofy/types`** — that hardcodes engine
  vocabulary into the package whose doc comment exists to forbid it, and it is
  wrong the day `AI_TTS_PROVIDER` flips.
- Rewrite the `transcript.ts` invariant comment honestly: gender is the only
  _portable_ selector; voice tokens are opaque, runtime-discovered, fallback-safe.
  The real invariant — no caller hardcodes engine voice vocabulary — survives.

## Rejected

- **Client-side `playbackRate` for speed.** `AudioBufferSourceNode` has no
  `preservesPitch` (HTMLMediaElement only), so ±25% audibly pitch-shifts. Worst
  case of server-side is one greyed control with a caption; worst case of client-side
  is the product sounding broken in both languages. Scheduling was never the
  blocker — `nextStartTime += buffer.duration / rate` would be trivial.
- **Hybrid speed.** Two mechanisms with different artifacts is worse than either.
- **Prisma settings column.** Migration + API + auth sync for an unstated need.
- **Two-pane settings panel.** Earns its keep past ~8 rows; there won't be 8.
- **Deferring voice selection.** User asked for it explicitly — sequenced last for
  risk, not cut.

## Risks

- **Placebo controls under ElevenLabs.** It already ignores `voiceGender`; after
  slice 2 it ignores `speed` too. If prod flips `AI_TTS_PROVIDER`, every control
  except volume and on/off silently does nothing. Slice 3's catalog endpoint
  doubles as the capability report to key controls off.
- **0.75× × backlog ceiling.** Slower playback lengthens turns → `MAX_BACKLOG_MS`
  (12s) trips sooner under concurrency → more dropped turns. Expected, not a bug.
- ~~**Disabled-state contrast** on the en→vi speed control is the likely
  `contrast-floors.spec.ts` tripwire.~~ **Corrected 2026-08-25:** that spec measures a
  hardcoded list of palette _token pairs_ (`:33-53`) and never renders a component, so
  it cannot catch this. `app-skin-guard.spec.ts` is the one that walks components;
  express the disabled state with a token pair rather than `opacity-50`.
- **Sub-1.0 speed drops sentences deterministically**, not occasionally — an ~8s
  translation plays ~10.7s at 0.75× against an 8s arrival cadence, so the backlog is
  monotonic and `MAX_BACKLOG_MS` is crossed within ~5 turns. Presets ship ≥ 1.0 unless
  a visible dropped-sentence marker ships with them.
- **`no_audio` conflation.** Voice-off turns will report outcome `no_audio`
  (`ws-events.ts:96`), same as "pipeline produced nothing". Acceptable now, but note
  it wherever turn metrics are read — or add a distinct outcome if the measurement
  channel matters.
- **Hydration.** Read localStorage after mount, never in a `useState` initializer.
- Kokoro speed assumed artifact-free (model length scale). One manual listen at
  0.75×/1.5× during slice 2 confirms.

## Handoff

`/ak:plan` → `/ak:cook`, slices in order. Carry `--advice`.

## Resolved in session

1. "Hardcode khá nhiều" = the fixed voice and speaking behaviour **only**. The
   `STATUS_LABEL` / `STATUS_TONE` copy maps stay as code. i18n explicitly out of scope.
2. Scope = **all three slices**, in order.
3. Transcript layout is a persisted runtime user setting; settings panel itself is
   a list, not two-pane.

## Unresolved questions

1. Settings surface always-visible or collapsible disclosure? Six rows is
   borderline. Recommend always-visible in slice 1, revisit at slice 3.
   Not blocking — plan can carry the recommendation.
