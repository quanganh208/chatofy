---
title: 'Phase 5: Voice catalog and picker'
status: todo
priority: P2
effort: '10h'
dependencies: [4]
---

# Phase 5: Voice catalog and picker

## Overview

"Chọn voice": a runtime-discovered catalog of curated voices per language, and a
picker that degrades to gender when the running backend offers none.

**This phase was rewritten after red-team review.** The first draft asserted that an
unknown voice token would "resolve via the existing `_voice_for` fallback" and that
`voice` could simply be "passed through". Both were false against the code, and the
proposed `VOICES` restructure would have broken the _default_ gender path — failing
every turn in both languages, for users who never picked a voice at all. What follows
is the corrected design; the effort estimate rose accordingly.

**This remains the cut line under scope pressure** — the only phase with
architectural risk, and the one whose cost is partly non-code (auditioning voices).

## Requirements

- Functional: the picker lists only voices the running backend reports; selecting one
  changes the spoken voice; an unknown, stale, or wrong-language token falls back to
  gender rather than erroring the turn; the picker hides when the catalog is empty
  but a misconfiguration is **visibly distinct** from an empty catalog.
- Non-functional: no engine's voice vocabulary appears in `@chatofy/types` or any
  client; an unrecognised token can never reach a provider's request path or an
  engine's `_infer`.

## Architecture

### What actually exists today (verified)

- `VOICES: ClassVar[Mapping[str, int | str]]` maps **gender → engine token**
  (`base.py:64`). `_voice_for(gender)` does `VOICES.get(gender or DEFAULT, VOICES[DEFAULT])`
  (`:84-90`) — no token branch, and its fallback _indexes `VOICES` by `"female"`_.
- `synthesize(text, gender, speed)` (`:92-100`) has **no** voice parameter.
- `SynthesizeRequest` is `{text, language, gender, speed}` (`app.py:48-55`); the call
  site is `engine.synthesize(text, req.gender, req.speed)` (`:80`).
- `TtsSynthesizeRequest` carries **no voice field at all** (`tts-provider.ts:15-25`).
  That absence is today's structural protection: ElevenLabs interpolates
  `${this.voice}` from config into its URL (`elevenlabs-tts-provider.ts:56`) and
  cannot receive a client value even by accident.

An unknown token reaching `_infer` today would hit `int(voice)` in Kokoro
(`kokoro_en.py:53`) → `ValueError` → 500 → `ProviderResponseError` — reproducing the
recorded outage class on the _local_ provider.

### The corrected design

**Keep `VOICES` exactly as it is.** Add a _separate_ catalog so the default path
`_voice_for` depends on is untouched:

```python
# engines/base.py
class VoiceEntry(NamedTuple):
    token: str
    label: str
    gender: str

CATALOG: ClassVar[tuple[VoiceEntry, ...]] = ()

def _resolve(self, voice: str | None, gender: str | None) -> int | str:
    """A token only survives if it is in this engine's own catalog."""
    if voice is not None:
        for entry in self.CATALOG:
            if entry.token == voice:
                return self._coerce(entry.token)
    return self._voice_for(gender)          # unchanged default path
```

`synthesize` gains `voice: str | None = None` and calls `_resolve(voice, gender)`.
`SynthesizeRequest` gains `voice: str | None = None`. **An unrecognised token never
reaches `_infer`** — that is the enforcement mechanism, and it is a pytest, not a
doc comment.

**Do not widen the shared `TtsSynthesizeRequest`.** Adding `voice?` to the interface
every provider implements restores the exact channel the outage used, replacing a
structural guarantee with prose one scroll above the interpolation. Instead: put
`voice` on a **local-provider-specific request type**, and gate at the call site in
`pipeline-translator.service.ts` — a provider that does not implement `listVoices`
never receives a `voice`. Any interpolation must additionally encode the value.

**Catalog transport:** engine `CATALOG` → sidecar `GET /voices?language=` →
`listVoices?(language)` on the local provider → API endpoint → web → picker.
ElevenLabs does not implement `listVoices` → empty catalog → picker hidden, gender
toggle remains. Add a short in-memory TTL cache on the API endpoint; it proxies to
the sidecar on every mount otherwise.

**The endpoint is authenticated.** `JwtAuthGuard` is a global `APP_GUARD`
(`auth.module.ts:90`) and `TranslateController` has no `@Public()` — its "No auth"
comment is stale and is corrected in phase 4. So the web call must go through
`apps/web/src/clients/api-client.ts`, which resolves the bearer token per request and
validates responses with zod (`:22-35`). Do **not** create a parallel `fetch` client:
it would 401, the "treat failure as no catalog" rule would hide the picker, and the
phase's own success criterion would still pass — shipping the feature permanently
invisible. **401/5xx must render as a distinct state from a genuinely empty catalog.**

**Storage is keyed by output language; the wire is not.** Phase 1 stores
`voice?: { en?: string; vi?: string }` (`translate-settings.ts:67-70`), because a
flat token survives a direction flip and delivers a Kokoro int sid to VieNeu —
disjoint vocabularies (`kokoro_en.py:26` vs `vieneu_vi.py:18`). The **wire stays a
single opaque `voice?: z.string().max(64)`**: the server already knows the output
language from `direction`, so sending both would let the two disagree. The client
selects `settings.voice[outputLanguage]` at `start()` and sends that one value, or
omits the field.

**Reconciliation happens at the point of use, not on load.** Phase 1's loader is
synchronous and cannot know an HTTP-fetched catalog; it only bounds the string. The
picker reconciles against the resolved catalog, and `start()` omits `voice` unless it
is present in the loaded catalog for the current output language. Because the catalog
may still be in flight or may have failed, **the provider- and engine-level fallbacks
are load-bearing, not belt-and-braces.**

### The invariant, rewritten honestly

`packages/types/src/domain/transcript.ts` declares gender the canonical voice
selector and says concrete voices "never appear on the wire". That comment must be
rewritten, not quietly violated: _gender is the only **portable** selector; voice
tokens are opaque, runtime-discovered and fallback-safe._ The real invariant — no
caller hardcodes an engine's voice vocabulary — survives intact. Reject any static
manifest in `@chatofy/types`.

### The catalog cannot be generated

Kokoro's 53 voices are bare integer sids with no name list exposed by sherpa-onnx;
`services/local-tts/models/` is empty in-repo (runtime download); today's gender
labels are audition results, not inferences from names (`kokoro_en.py:20-23`,
`vieneu_vi.py:11-14`). So the catalog is ~3-4 auditioned voices per gender per
language with human labels. **Not all 53.** The audition is product work and gates
this phase.

## Related Code Files

- Modify: `services/local-tts/engines/base.py` (`VoiceEntry`, `CATALOG`, `_resolve`, `synthesize`)
- Modify: `services/local-tts/engines/kokoro_en.py`, `vieneu_vi.py` (curated `CATALOG`, `VOICES` untouched)
- Modify: `services/local-tts/app.py` (`GET /voices`, `voice` on `SynthesizeRequest`)
- Modify: `services/local-tts/test_app.py`
- Modify: `packages/ai-providers/src/interfaces/tts-provider.ts` (`listVoices?` only — **not** `voice`)
- Modify: `packages/ai-providers/src/providers/local-speech/local-speech-tts-provider.ts`
- Modify: `packages/ai-providers/src/providers/elevenlabs/elevenlabs-tts-provider.ts` (+ regression test)
- Modify: `apps/api/src/modules/translate/services/pipeline-translator.service.ts` (call-site gate)
- Modify: `packages/types/src/events/ws-events.ts` (`voice?: z.string().max(64)`)
- Modify: `packages/types/src/domain/transcript.ts` (rewrite the invariant comment)
- Modify: `apps/api/src/modules/translate/translate.controller.ts` (or a voices controller)
- Modify: `apps/web/src/clients/api-client.ts` (catalog call + zod schema)
- Modify: `apps/web/src/components/translate/translate-settings-panel.tsx`

## Implementation Steps

1. **Audition first.** Listen to candidate Kokoro sids and VieNeu presets; choose ~3-4
   per gender per language and write human labels. Gates everything below.
2. Add `VoiceEntry`, `CATALOG`, `_resolve` and the `voice` parameter to `base.py`,
   leaving `VOICES` and `_voice_for` untouched. Populate `CATALOG` per engine.
3. Add `voice: str | None` to `SynthesizeRequest`; pass it to `engine.synthesize`.
4. Add sidecar `GET /voices?language=` returning `{token, label, gender}[]`; 400 for
   an unsupported language, matching `/synthesize`.
5. Add `listVoices?(language)` to `TtsProvider`. Put `voice` on a local-provider
   request type only, and gate it in `pipeline-translator.service.ts` so a provider
   without `listVoices` never receives one.
6. Add `voice?: z.string().max(64)` to `sessionOptionsSchema`, `.optional()`, carried
   as phase 4 carried `speed`. Send only the entry for the current output language.
7. API endpoint with a short TTL cache; returns empty when the provider has no
   `listVoices`. Add the call to `api-client.ts` with a zod response schema.
8. Web: render a `Select` when the catalog is non-empty; hide it when empty; show a
   distinct state on 401/5xx. Reconcile the persisted token against the resolved
   catalog and omit it from `start()` when absent. `disabled={running}`, like every
   other wire control.
9. Rewrite the `transcript.ts` invariant comment.
10. Tests:
    - pytest: **the no-token, known-gender path still works** in both languages —
      the case the original draft would have broken silently;
    - pytest: an unknown token never reaches `_infer` and falls back to the gender default;
    - provider: the ElevenLabs URL is byte-identical for any `req.voice`, including
      `../` and a 64-char string;
    - web: an empty catalog hides the picker; a 401 does not look like an empty catalog;
    - web: a stale or wrong-language token is omitted from `start()`.

## Success Criteria

- [x] Picker lists only voices the running backend reports
- [x] Selecting a voice changes the spoken voice
- [x] **The no-token, known-gender path is unchanged** in both languages (regression-tested)
- [x] Unknown/stale/wrong-language token falls back to gender — never a 4xx/5xx turn
- [x] An unrecognised token provably never reaches `_infer` or any request path
- [x] ElevenLabs URL unaffected by any client-supplied `voice`
- [x] A 401 or 5xx on the catalog is visibly distinct from an empty catalog
- [x] Picker hidden under a provider with no catalog; gender still works
- [x] No engine voice vocabulary in `@chatofy/types` or any client
- [x] `transcript.ts` invariant comment rewritten to match reality
- [x] `pnpm typecheck` + `pnpm lint` + `pnpm test` + sidecar pytest + api e2e green

## Rollback

Mutates `packages/types` and the sidecar contract. The sidecar tolerates a missing
`voice` (it is `None`-defaulted), so rolling back web/api alone is safe. Rolling back
the sidecar while a client still sends `voice` is also safe — FastAPI ignores unknown
body fields by default; confirm that before relying on it. Deploy sidecar → api → web.

## Risk Assessment

- **Reopening the outage.** Signal: any turn 4xx/5xx after a provider switch or a
  catalog revision. Response: the `_resolve` whitelist, the call-site gate and the
  ElevenLabs URL test are mandatory. Do not ship the picker without all three.
- **Breaking the default path while adding the catalog.** Signal: turns fail for users
  who never picked a voice. Response: `VOICES`/`_voice_for` are untouched by design,
  and step 10's first pytest exists specifically to catch this.
- **Audition never happens, so labels get invented from sid numbers.** Signal: labels
  like "Voice 9". Response: cut the phase rather than ship guessed labels — the repo's
  own comments warn that names are not inferable.
- **Catalog fetch fails, or the sidecar is still loading (`/healthz` 503 during model
  load).** Signal: picker empty on a backend that has voices. Response: distinct error
  state, retry on next mount — never silently identical to "no catalog".
- **Curated set may not satisfy "chọn voice" as the user imagined it.** Signal: user
  asks why only a few voices. Response: accepted trade-off recorded in the brainstorm;
  expanding means more audition, not more code.
