---
phase: 4
title: 'Mobile translated-voice parity'
status: completed
priority: P2
effort: '3h'
dependencies: []
---

# Phase 4: Mobile translated-voice parity

## Goal

The mobile lobby offers a Female/Male "Translated voice" choice with a one-line
explanation, and the mobile speaker leg uses it. Today the mobile leg passes no
voice, so every mobile speaker gets the schema default
(`apps/mobile/src/conference/conference-cascade-leg-native.ts:47-49` says so).

## Context the executor needs

- Mobile lobby: `apps/mobile/app/(app)/conference/index.tsx`. It already prefills
  the name from `session?.user.name` (line 39) and renders `LanguagePicker`
  (line 184). `openRoom()` (line ~80) pushes `/(app)/conference/[roomId]` with
  params `{ roomId, displayName, lang }`.
- Call screen: `apps/mobile/app/(app)/conference/[roomId].tsx` reads params at
  line ~91 and calls `useConferenceNative(roomId, {...})` at line ~113.
- Hook: `apps/mobile/src/conference/use-conference-native.ts` — options at line
  148 (`{ displayName, sourceLanguage, getToken }`), builds the leg at line ~404
  with `createNativeConferenceLeg({...})`.
- Leg: `apps/mobile/src/conference/conference-cascade-leg-native.ts` —
  `NativeConferenceLegOptions` (line 24) and `createConferenceCascadeLeg({...})`
  (line ~56). The shared leg accepts `voice?: { voiceGender?, speed?, voices? }`
  (`packages/realtime-client/src/conference/conference-cascade-leg.ts:55-67`).
- Gender values: `voiceGenderSchema = z.enum(['female', 'male'])` and
  `DEFAULT_VOICE_GENDER`, both from `@chatofy/types`.
- Mobile strings come from `createTranslator(en)`; use `common.*` keys only.
- Mobile tests: `pnpm --filter mobile test` runs `node --test` over `src/**/*.test.ts` (pure TS, no React).
- No persistence of the choice on mobile in this phase (mobile has no settings store; `expo-secure-store` is for secrets). Accepted.

## Tasks

### Task 4.1 — Add shared voice strings

- Target files: `packages/i18n/src/en.ts`, `packages/i18n/src/vi.ts`.
- Steps:
  1. Phase 3 task 3.1 adds `common.conference.translatedVoice`, `common.conference.voiceFemale`, `common.conference.voiceMale`. Run `grep -c "common.conference.voiceMale" packages/i18n/src/en.ts`; if it prints `0` (phase 4 ran first), add those three exactly as listed in phase 3 task 3.1. Never add a key twice.
  2. Add (same order in both): `common.conference.translatedVoiceHint` — en "Others hear your translated speech in this voice.", vi "Người khác nghe bản dịch lời bạn bằng giọng này."
  3. `pnpm --filter @chatofy/i18n build`.
- Verify: `pnpm --filter @chatofy/i18n test` exits 0.

### Task 4.2 — Pure param parser with a test

- Goal: a route param string becomes a valid gender.
- Target files: create `apps/mobile/src/conference/conference-voice-param.ts` and `apps/mobile/src/conference/conference-voice-param.test.ts`.
- Steps:
  1. Export `parseVoiceGenderParam(raw: unknown): VoiceGender` returning `voiceGenderSchema.safeParse(raw)` data, else `DEFAULT_VOICE_GENDER`. Import the type the way other mobile files import from `@chatofy/types`.
  2. Test with `node:test` + `node:assert/strict` in the style of `apps/mobile/src/conference/conference-room-peer-language.test.ts`: `'male'` → `'male'`; `'female'` → `'female'`; `undefined` → default; `'robot'` → default.
- Verify: `pnpm --filter mobile test` exits 0 and its output contains `conference-voice-param`.

### Task 4.3 — Voice picker component

- Target files: create `apps/mobile/src/components/conference/voice-gender-picker.tsx`.
- Steps:
  1. Copy the structure and styles of `apps/mobile/src/components/conference/language-picker.tsx` (same props shape: `t`, `value`, `onChange`, `locked`), with two options `female`/`male` labelled by the new `common.conference.voiceFemale`/`voiceMale` keys, label `common.conference.translatedVoice`.
  2. Under the track, a `Text` in `colors.textSecondary`, size matching the label, with `common.conference.translatedVoiceHint`.
- Verify: `pnpm --filter mobile typecheck` exits 0.

### Task 4.4 — Wire lobby → call screen → hook → leg

- Target files: `apps/mobile/app/(app)/conference/index.tsx`, `apps/mobile/app/(app)/conference/[roomId].tsx`, `apps/mobile/src/conference/use-conference-native.ts`, `apps/mobile/src/conference/conference-cascade-leg-native.ts`.
- Steps:
  1. Lobby: `const [voiceGender, setVoiceGender] = useState<VoiceGender>(DEFAULT_VOICE_GENDER)`; render `<VoiceGenderPicker t={t} value={voiceGender} onChange={setVoiceGender} locked={false} />` right under `LanguagePicker`; add `voice: voiceGender` to the `router.push` params and to `openRoom`'s dependency list.
  2. Call screen: add `voice?: string` to the `useLocalSearchParams` type; `const voiceGender = parseVoiceGenderParam(params.voice)`; pass `voiceGender` into `useConferenceNative(roomId, { …, voiceGender })`.
  3. Hook: add `voiceGender: VoiceGender` to the options type (line 148), destructure it, pass it to `createNativeConferenceLeg({ …, voiceGender })`, and add it to the `useCallback` dependency array that currently ends `[roomId, displayName, sourceLanguage, getToken, …]`.
  4. Leg: add `voiceGender: VoiceGender` to `NativeConferenceLegOptions` with a doc comment ("Chosen in the lobby; what other participants hear this speaker's translation in."); pass `voice: { voiceGender: options.voiceGender }` to `createConferenceCascadeLeg`; replace the doc comment "Voices are the schema defaults: mobile has no translate settings screen to inherit them from." with "The gender is chosen in the lobby; specific voices and speed are the schema defaults."
- Success criteria: typecheck passes; the param flows end to end.
- Verify: `pnpm --filter mobile typecheck` exits 0, `pnpm --filter mobile test` exits 0, and `grep -n "voiceGender" apps/mobile/src/conference/conference-cascade-leg-native.ts` prints at least 2 lines.

## Phase exit check

- Verify: `pnpm --filter mobile lint` exits 0.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:

- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
  Apply kongming's guidance, then re-run the Verify step.
  If `kongming` cannot be spawned in this environment, STOP and report the same
  failure evidence to the user. Never continue by self-reasoning.
