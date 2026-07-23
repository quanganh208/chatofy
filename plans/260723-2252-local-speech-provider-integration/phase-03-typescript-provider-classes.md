---
phase: 3
title: 'Phase 3: TypeScript provider classes'
status: todo
priority: P1
effort: '2h'
dependencies: [1, 2]
---

# Phase 3: TypeScript provider classes

## Overview

Add the two client classes in `@chatofy/ai-providers` that speak to the sidecars
from Phases 1 and 2, both registered under the provider name `local`. Depends on
both sidecars being reachable so the contracts are verified against a live
server, not against this document.

## Requirements

- Functional: `LocalSpeechSttProvider` implements `SttProvider.transcribe` and
  routes vi/en by passing the `language` argument through to the sidecar.
- Functional: `LocalSpeechTtsProvider` implements `TtsProvider.synthesize` and
  declares `outputMimeType = 'audio/wav'`.
- Non-functional: no new runtime dependency — global `fetch`/`FormData`/`Blob`
  only, matching every existing provider in the package.
- Non-functional: errors map onto the existing `ProviderConfigError` /
  `ProviderConnectionError` / `ProviderResponseError` taxonomy so
  `PipelineTranslatorService.handlePipelineError` keeps working untouched.

## Architecture

Both classes follow the shape already established in the package:
constructor validates `baseUrl` and throws `ProviderConfigError`; the trailing
slash is trimmed so `${baseUrl}/route` never doubles up; `fetch` rejection wraps
into `ProviderConnectionError` with `cause` preserved; non-2xx becomes
`ProviderResponseError` carrying the status and a `truncate()`d body.

`LocalSpeechSttProvider` deliberately mirrors `ElevenLabsSttProvider`'s
`FormData` construction — same `extFromMime()` filename helper, same
`new Blob([new Uint8Array(audio)], { type: mimeType })` copy (a fresh
ArrayBuffer-backed view is required to satisfy `BlobPart` regardless of the
caller's backing buffer).

```ts
// local-speech-stt-provider.ts
export interface LocalSpeechSttConfig {
  baseUrl?: string;
}

export class LocalSpeechSttProvider implements SttProvider {
  readonly name = 'local';
  async transcribe(
    audio: Uint8Array,
    mimeType: string,
    language: LanguageCode,
  ): Promise<SttTranscriptResult> {
    const form = new FormData();
    form.append('language', language);
    form.append(
      'file',
      new Blob([new Uint8Array(audio)], { type: mimeType }),
      `audio.${extFromMime(mimeType)}`,
    );
    // POST `${baseUrl}/transcribe` -> { text, language }
  }
}
```

```ts
// local-speech-tts-provider.ts
export interface LocalSpeechTtsConfig {
  baseUrl?: string;
  voice?: string;
}

export class LocalSpeechTtsProvider implements TtsProvider {
  readonly name = 'local';
  readonly outputMimeType = 'audio/wav';
  async synthesize(req: TtsSynthesizeRequest): Promise<Uint8Array> {
    // POST `${baseUrl}/synthesize` JSON { text, language, voice? } -> wav bytes
  }
}
```

Return `language` from the sidecar response when present, otherwise echo the
requested language — the sidecar is told which language to use, so it cannot
disagree, and echoing avoids a spurious failure mode.

**No request timeout**, matching `VieNeuTtsProvider` and the ElevenLabs
providers. Introducing one here only would be an inconsistent partial fix;
if timeouts are wanted they belong across all providers as separate work.

## Related Code Files

- Create: `packages/ai-providers/src/providers/local-speech/local-speech-stt-provider.ts`
- Create: `packages/ai-providers/src/providers/local-speech/local-speech-tts-provider.ts`
- Modify: `packages/ai-providers/src/index.ts` (barrel exports)
- Delete: `packages/ai-providers/src/providers/local-whisper/` (empty scaffold dir)
- Delete: `packages/ai-providers/src/providers/local-tts/` (empty scaffold dir)
- Reference (read-only): `packages/ai-providers/src/providers/elevenlabs/elevenlabs-stt-provider.ts`, `packages/ai-providers/src/providers/vieneu/vieneu-tts-provider.ts`, `packages/ai-providers/src/providers/http-util.ts`

## Implementation Steps

1. **Delete the two empty scaffold directories.** `providers/local-whisper/` and
   `providers/local-tts/` are leftover placeholders that would otherwise sit
   next to the real `providers/local-speech/` and confuse future readers.

2. **`local-speech-stt-provider.ts`** — implement as sketched. Reuse
   `extFromMime` and `truncate` from `../http-util.js` (note the `.js`
   extension in imports — this package uses NodeNext ESM resolution). Throw
   `ProviderConfigError('Local STT requires a baseUrl')` when `baseUrl` is
   missing. Parse the JSON body; a missing/blank `text` field is returned as-is
   (an empty transcript is a legitimate result — `PipelineTranslatorService`
   already turns it into `BadRequestException('No speech detected in the audio')`).

3. **`local-speech-tts-provider.ts`** — implement as sketched. Send `voice`
   only when a per-request or configured voice exists (same conditional-field
   pattern as `VieNeuTtsProvider`). Always send `language` so the sidecar's
   English-only guard is meaningful. Return `new Uint8Array(await res.arrayBuffer())`.

4. **Barrel exports in `index.ts`** — add both classes and both config types
   alongside the existing concrete provider exports at the bottom of the file.

5. **Verify against the live sidecars** — with both sidecars running, exercise
   each class once (a scratch script or a Node one-liner) to confirm the wire
   format actually matches Phases 1 and 2. This is the point of the phase
   dependency; do not skip it in favour of reading the code.

6. **`pnpm --filter @chatofy/ai-providers typecheck`** and `pnpm lint`.

## Success Criteria

- [x] Both classes compile and satisfy `SttProvider` / `TtsProvider` structurally
- [x] Both throw `ProviderConfigError` when constructed without `baseUrl`
- [x] Both trim a trailing slash on `baseUrl`
- [x] A live round-trip against :8002 returns real transcript text
- [x] A live round-trip against :8003 returns bytes starting with `RIFF`
- [x] The two empty scaffold directories are gone
- [x] `pnpm typecheck` and `pnpm lint` clean

## Risk Assessment

- **Wire-format drift between plan and sidecar (Medium).** Mitigated by Step 5's
  live round-trip. The field names in this phase and the contract table in
  `plan.md` must match the implemented sidecar; if the sidecar deviated during
  Phases 1–2, fix the deviation or update `plan.md` — do not let the two drift.
- **`FormData`/`Blob` availability (Low).** Global on Node 18+; the package
  already relies on this in `ElevenLabsSttProvider`.
- **knip flagging new exports (Low).** They become reachable once Phase 4
  registers them; if `pnpm knip` is run between Phase 3 and 4 it may report
  them as unused. Expected — re-check after Phase 4 rather than adding an ignore.
