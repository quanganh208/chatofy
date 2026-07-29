# Brainstorm — output voice gender field (vi↔en TTS)

Date: 2026-07-29 · Branch: `main` · Status: accepted, ready to plan

## Contract

**Outcome.** One user-facing field `voiceGender: 'female' | 'male'` honored on
both transports and both directions. Four (language × gender) slots bound to
voices picked by listening.

**Constraints.** Engine voice tokens stay engine-private (Kokoro int sid, VieNeu
preset name). Unknown/absent value falls back, never fails a turn. WS gender
fixed per session, like `direction`. Local sidecar stays the default backend.

**Non-goals.** Per-clause voice switching. Speaking-rate control. Mid-session
voice change. ElevenLabs gender parity. Mobile UI (`apps/mobile/src` has no
translate wiring yet).

**Acceptance.** WS session started with `voiceGender: 'male'` returns male audio
both directions; same for REST. Unit tests on gender→token resolution in both
engines. `pnpm knip` exit 0 after the deletions below.

## Diagnosis (why "hardcode" is accurate)

| Path              | en output                             | vi output                                                    |
| ----------------- | ------------------------------------- | ------------------------------------------------------------ |
| `POST /translate` | fixed — Kokoro sid 0, server env only | selectable — `voice` string, picker on `/translate/baseline` |
| `/ws/translate`   | fixed                                 | fixed                                                        |

Root cause on WS: `translation-session.service.ts` `streamClauses()` calls
`pipeline.synthesize({ text, language })` — no voice argument exists on that
path, and `client.session.start` carries only `direction`. REST's `voice` is a
free-form string only VieNeu understands: `ElevenLabsTtsProvider.resolveVoiceId`
regex-rejects preset names, `KokoroEn._resolve_sid` parses it as an int.

## Voice selection — evidence

25-sample audition against the live sidecar (all 11 Kokoro sids, all 14 VieNeu
presets, one sentence each, current `voice` contract, no repo code added).
Script + wavs in the session scratchpad. User verdict:

|                    | female       | male         |
| ------------------ | ------------ | ------------ |
| en (Kokoro sid)    | 3 `af_sarah` | 5 `am_adam`  |
| vi (VieNeu preset) | `Mai Anh`    | `Thanh Bình` |

Two findings the audition earned: en female moves off sid 0 (the `af` blend that
won the earlier model-level A/B), and `Thanh Bình` is male — unisex by name, so
name-based gender labelling would have shipped a male voice under Female.

## Decisions

| #   | Decision                                                        | Rationale                                                                                                                                         |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `voiceGender` **replaces** `voice`; no escape hatch kept        | two overlapping selectors need a permanent precedence rule; nothing consumes the free-form one but the picker being replaced                      |
| D2  | gender→token map lives in the **Python engines**                | only the engine knows what a token means (existing repo rule); keeps Kokoro sids and Vietnamese names out of the wire and out of `@chatofy/types` |
| D3  | `TtsProvider` request field becomes `voiceGender?: VoiceGender` | engine-agnostic concept at an engine-agnostic boundary                                                                                            |
| D4  | ElevenLabs ignores gender, keeps its single configured id       | cloud path is a latency/quality comparison baseline, not a shipped feature; a second env voice id would be dead weight                            |
| D5  | absent field defaults to `'female'` both languages              | one predictable default beats a per-language one; **flips vi**, whose current default `Phạm Tuyên` is male                                        |
| D6  | field optional on the wire with `.default('female')` in zod     | parsed output is total, so `TurnSession` always holds a concrete value; no break for a client sending only `direction`                            |

## Change map

- `packages/types` — `voiceGenderSchema`; add to `clientSessionStartSchema` +
  `translateRequestSchema`; **delete** `VIENEU_VOICES` (hand-maintained 14-name
  mirror).
- `packages/ai-providers` — `TtsSynthesizeRequest.voice` → `voiceGender`;
  `LocalSpeechTtsProvider` forwards it; `ElevenLabsTtsProvider` drops
  `resolveVoiceId`.
- `apps/api` — `TurnSession` gains `voiceGender` beside `direction`; gateway
  passes it from `session.start`; `streamClauses()` and `translateTurn()` pass it
  into `synthesize()`; `TranslateTurnInput.voice` → `voiceGender`.
- `services/local-tts` — `TtsEngine.VOICES: dict[gender, token]` on the base,
  `synthesize(text, gender, speed)`; per-engine constants from the table above.
  **Delete** `GET /voices`, `preset_voices`, `EngineRegistry.voices()`,
  `LOCAL_TTS_VOICE_EN`, `LOCAL_TTS_VOICE_VI`.
- `apps/web` — `VoicePicker` becomes a 2-option gender toggle and moves onto
  `/translate` (streaming page, no picker today); baseline page keeps it, no
  longer gated on `direction === 'en_to_vi'`.
- Docs — `codebase-summary.md` (`POST /translate` body, TTS bullet, env list),
  `services/local-tts/README.md` (API table, model table).

Net: one field replaces a free-form string, a 14-name mirror, an uncalled
endpoint, and 2 env vars.

## Risks

- Test surface: `translate.e2e-spec.ts`, `translate-ws-stream.e2e-spec.ts`,
  `translate-local-speech-sidecar.e2e-spec.ts`, `local-speech-providers.spec.ts`,
  `elevenlabs-providers.spec.ts`, `turn-session.spec.ts`,
  `translation-session.service.spec.ts` all touch the voice/start contract.
- Sidecar `test_app.py` asserts `/voices`; removed with the endpoint.
- D5 changes shipped vi behavior — flag in the PR body, not only in code.
- Jest on `apps/api` is install-fragile (hoisted-linker dual-jest); verify the
  runner works before trusting a green run.

## Unresolved

1. Should `/translate/baseline` keep the picker at all, or is the gender toggle
   only worth having on the streaming page? (Baseline exists as the measurement
   comparison; a second control there is arguably noise.)
2. Sidecar left running on :8003 from the audition — stop it, or keep it warm
   for implementation verification?
