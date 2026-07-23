# Code Review — local speech providers (`feat/local-speech-providers`)

Date: 2026-07-24
Scope: 8 commits, `main...feat/local-speech-providers` (63 files, +4777 / −2075)
Reviewer posture: production-readiness, correctness + regressions only.

## Verdict

The design is sound and the concurrency model is correct — I found **no deadlock,
no race, and no shared-state bug** between the two engines now sharing a process.
Three defects are confirmed and blocking-ish; the rest are robustness/doc gaps.

Baseline re-verified: `pnpm typecheck` clean (10/10 tasks). The one broken file is
invisible to every gate you listed, which is exactly why it survived.

---

## Critical / High

### H1. Deleted provider still imported by the e2e suite — `pnpm --filter api test:e2e` fails

`apps/api/test/translate-en-vi-sidecar.e2e-spec.ts:1`

```ts
import { VieNeuTtsProvider } from '@chatofy/ai-providers';
```

`VieNeuTtsProvider` was removed from `packages/ai-providers/src/index.ts` in commit
`3b43995`. Confirmed, not speculative — I ran it:

```
FAIL test/translate-en-vi-sidecar.e2e-spec.ts
  ● Test suite failed to run
    test/translate-en-vi-sidecar.e2e-spec.ts:1:10 - error TS2305:
    Module '"@chatofy/ai-providers"' has no exported member 'VieNeuTtsProvider'.
```

**Why every gate missed it.** `apps/api/tsconfig.json` has `"exclude": ["node_modules",
"dist", "test"]`, so `pnpm typecheck` never sees it. `apps/api/package.json` jest config
sets `"rootDir": "src"` with `testRegex: ".*\\.spec\\.ts$"`, so `pnpm test` never sees it.
Only `test:e2e` (`test/jest-e2e.json`, `rootDir: "."`) compiles it — and that is not in the
listed gates. The delivery report's "all clean" verification line is true and still misses this.

**Failure scenario.** Anyone (or CI, if e2e is ever wired up) running `pnpm --filter api
test:e2e` gets a red suite that has nothing to do with their change. The whole e2e run
fails, including `translate.e2e-spec.ts`, because a failed-to-compile suite is a suite failure.

**Fix.** Delete the file — it tests a provider that no longer exists, and its replacement
(`local` TTS against :8003) has no equivalent. If you want the integration check back, rewrite
it as `LocalSpeechTtsProvider` against `LOCAL_TTS_URL` gated on `RUN_LOCAL_SPEECH_E2E=1`.
Separately: consider adding `apps/api/test` to a typecheck path, or the same class of rot
recurs.

---

### H2. AC#3 is not met for en→vi — the ElevenLabs fallback is broken from the web UI

`apps/api/src/modules/translate/providers/ai-providers.factory.ts:47` (removed special-case)
→ `packages/ai-providers/src/providers/elevenlabs/elevenlabs-tts-provider.ts:45`

The delivery report states the consequence deliberately ("Vietnamese output now goes to
ElevenLabs instead of silently falling back to VieNeu. The setting means what it says") —
but it stops one step short. The web client still sends a VieNeu **preset name** as `voice`:

- `apps/web/app/translate/page.tsx:25` — `useState('Phạm Tuyên')`
- `apps/web/src/hooks/use-translate-turn.ts:79` — `...(options.direction === 'en_to_vi' ? { voice: options.voice } : {})`
- `packages/types/src/http/translate.ts:50` — `VIENEU_VOICES` (14 Vietnamese names)

`ElevenLabsTtsProvider.synthesize` does `const voiceId = req.voice ?? this.voice` and
interpolates it straight into the path:

```ts
const url = `${TTS_BASE}/${voiceId}?output_format=${this.outputFormat}`;
```

**Failure scenario.** Operator sets `AI_TTS_PROVIDER=elevenlabs` per README ("Switching back
to the cloud"), opens the web UI, picks en→vi, clicks Translate. Request goes to
`https://api.elevenlabs.io/v1/text-to-speech/Ph%E1%BA%A1m%20Tuy%C3%AAn?...` → 404/422 →
`ProviderResponseError` → `ServiceUnavailableException` → **every en→vi turn is a hard 503**.
Never happened before this branch because `targetLang === 'vi'` forced VieNeu regardless.
vi→en still works, so this looks like an intermittent sidecar problem rather than a config bug.

**Fix options** (pick one, this is a product decision):

1. Drop `voice` when the resolved TTS backend is not `local` (cleanest: the voice vocabulary
   is backend-specific and the type comment already says so).
2. `ElevenLabsTtsProvider`: reject/ignore a `voice` that is not a plausible ElevenLabs voice id
   and fall back to `this.voice`, mirroring what Kokoro/VieNeu already do for unknown voices.
3. Gate the web voice picker on the active TTS backend (needs a capability endpoint — heaviest).

Note `packages/types/src/http/translate.ts:38` is now wrong either way: "ignored for vi→en
(ElevenLabs uses its configured voice)" — with `local` TTS, a vi→en `voice` **is** forwarded
and interpreted as a Kokoro speaker id.

---

### H3. No size or duration bound anywhere on the new local STT path

`services/local-stt/audio/decode.py:38`, `services/local-stt/app.py:65`

The chain has no cap at any layer:

| Layer                                       | Bound                                                 |
| ------------------------------------------- | ----------------------------------------------------- |
| `apps/api/src/main.ts:19`                   | `json` body limit `12mb` → ≈9 MB decoded audio        |
| `apps/web/.../audio-source-controls.tsx:57` | `<input type="file" accept="audio/*">`, no size check |
| `use-audio-recorder.ts`                     | no max recording duration                             |
| `LocalSpeechSttProvider.transcribe`         | none                                                  |
| `/transcribe`                               | `file.file.read()` — full read, no cap                |
| `decode_to_16k_mono`                        | no duration cap                                       |

9 MB of Opus at ~24 kbps ≈ **50 minutes** of audio. That decodes to 48 M float32 samples:
`chunks` list (~192 MB) + `np.concatenate` (~192 MB) + `.astype(np.float32)` copy (~192 MB,
and it copies even though the input is already float32) ≈ **600 MB peak** before inference
starts. Then `SttEngine.transcribe` holds `self._lock` for the entire offline decode of a
single 50-minute stream — Moonshine is a full-attention transformer, so encoder memory there
is superlinear in T.

**Failure scenario.** One user uploads a long recording. The `en` lock is held for minutes;
every other English `/translate` queues behind it and eventually hits undici's ~300 s default
(see M2) → 503 for everyone. Worse case the sidecar is OOM-killed; `pnpm dev:all` uses
`concurrently` with no restart policy, so **the sidecar stays dead** and all `/translate`
returns 503 until someone notices. This is a new failure mode: with cloud ElevenLabs the
bound was upstream and requests did not serialize.

**Fix.** Cheapest effective guard, in `decode_to_16k_mono`:

```python
MAX_SECONDS = 300  # bound the lock hold and the encoder's memory
...
total = sum(len(c) for c in chunks)
if total > TARGET_RATE * MAX_SECONDS:
    raise DecodeError(f"audio longer than {MAX_SECONDS}s")
```

Better: accumulate and bail mid-loop so you never materialise the full array. Also add a byte
cap on `file.file.read()` and a client-side file-size check. Consider
`np.concatenate(chunks, dtype=np.float32)` to drop the redundant `astype` copy.

---

## Medium

### M1. `services/local-tts/README.md` is materially wrong after the absorb commit

Commit `6912ddb` moved Vietnamese synthesis in but did not update the service README:

- L3, L10–12: "Local **English** speech synthesis", "**English only.** Vietnamese synthesis
  stays in `services/vieneu-tts`" — that service is deleted in the same commit.
- L8: "same convention as `services/vieneu-tts`" (also in `services/local-stt/README.md:8`).
- API table: no `GET /voices` row; claims `POST /synthesize` returns "`400` for … a
  non-English `language`" — it returns 400 for `fr`, 200 for `vi`.
- **Config table documents `LOCAL_TTS_VOICE_ID`, which no code reads.** `kokoro_en.py:19`
  reads `LOCAL_TTS_VOICE_EN`; `vieneu_vi.py:17` reads `LOCAL_TTS_VOICE_VI`. Following the
  README to change the default voice silently does nothing.

Neither `LOCAL_TTS_VOICE_EN`, `LOCAL_TTS_VOICE_VI`, `LOCAL_STT_THREADS` nor `LOCAL_TTS_THREADS`
appears in `apps/api/.env.example` or the root README — they are only discoverable by reading
Python source.

### M2. No request timeout on either local provider

`local-speech-stt-provider.ts:53`, `local-speech-tts-provider.ts:45` — bare `fetch` with no
`AbortSignal.timeout(...)`. Node/undici defaults to ~300 s headers timeout.

**Failure scenario.** Sidecar is alive but a thread is stuck under the lock (H3, or a wedged
native call). The Nest request occupies a connection for five minutes; the web client's own
timeout fires first and the user sees "Request timed out", while the API keeps the socket and
the log shows nothing. Same class as the old VieNeu provider, but it now sits on the **default**
path for both speech stages, so the blast radius is new.

Suggested: `signal: AbortSignal.timeout(30_000)` for TTS and 60_000 for STT (Kokoro p50 is
~750 ms, VieNeu ~1.4 s; 30 s is 20× headroom). `AbortError` already lands in the `catch` and
becomes `ProviderConnectionError` → 503, which is the right status.

### M3. ONNX Runtime thread oversubscription across the two co-resident engines

`services/local-tts/app.py:18-20`, `engines/base.py:27`, `kokoro_en.py:37`, `vieneu_vi.py:26`
(and the mirror in `local-stt`).

The per-engine lock is deliberately per-engine so vi and en can overlap — that is the right
call for latency, but it means on an 8-physical-core box you get Kokoro's 8 ORT threads plus
whatever session VieNeu builds (it is constructed as `Vieneu(mode="v3turbo")` with no thread
argument, so it takes ORT's default, i.e. all cores). `OMP_NUM_THREADS` is set with
`setdefault`, which helps OpenMP but is not the ORT intra-op knob.

**Consequence.** Two simultaneous users on opposite directions: both syntheses run ~2× slower
than the benchmarked p95 the docs quote. Not a correctness bug, but the "p95 1.18 s" claim in
`services/local-tts/README.md` and the root README only holds single-user. Same applies to
local-stt (2 × 8 threads).

Worth either capping (`LOCAL_TTS_THREADS=4` when both engines are resident) or documenting
that the numbers are single-concurrency.

### M4. Sidecar 4xx is laundered into 503 at the API

`pipeline-translator.service.ts:144-151` maps every `ProviderResponseError` to
`ServiceUnavailableException`, discarding `err.status`.

The sidecars are careful to return 400 for genuine client errors (unsupported language,
undecodable audio, empty text) — and that signal is thrown away. A user who uploads a corrupt
file gets "Translation provider request failed / 503", implying the server is down.
AC#4 says "never a raw 500", which is satisfied; but 503 for a client-caused 400 is still wrong
and will generate false alarms in any uptime monitor watching 5xx.

Suggested:

```ts
if (err instanceof ProviderResponseError) {
  this.logger.error(`Provider returned an unusable response: ${err.message}`);
  if (err.status && err.status >= 400 && err.status < 500 && err.status !== 429) {
    throw new BadRequestException('The audio could not be processed');
  }
  throw new ServiceUnavailableException('Translation provider request failed');
}
```

Note this interacts with H2: today that ElevenLabs 404 is a 503, which is what makes H2 hard
to diagnose.

---

## Low

- **L1. `download_models.py` is not interrupt-safe.** `services/local-stt/scripts/download_models.py:45`
  — `shutil.copyfile(cached, target)`; a Ctrl-C mid-copy leaves a truncated file that
  `target.exists()` treats as complete on the next run. Same for `tokens.txt` generation
  (L52-59): interrupt after `open(..., "w")` leaves a partial token table, and sherpa-onnx
  will fail obscurely at load. The tarball paths already use the correct `.part` + rename
  pattern — apply it here too.
- **L2. Unvalidated `speed`.** `services/local-tts/app.py:53` — `speed: float = 1.0`, no bound.
  `speed=0` reaches `OfflineTts.generate(..., speed=0)`. Unreachable from `LocalSpeechTtsProvider`
  (it never sends `speed`) and uvicorn binds 127.0.0.1, so this is localhost-only. Add
  `Field(gt=0, le=4)` anyway — it is one line.
- **L3. `text` is unbounded** in `SynthesizeRequest`. Bounded transitively by H3; fix H3 and
  this mostly goes away, but a `max_length` is cheap insurance for the lock-hold time.
- **L4. `/healthz` "loading" branch is unreachable.** `app.py:44` in both services — uvicorn
  does not accept connections until lifespan startup returns, and `load_all()` is synchronous
  inside it. Harmless, but the README's "`503 {"status":"loading"}` otherwise" describes a
  state no client can observe.
- **L5. `unload_all()` only clears the dict.** `engines/registry.py:39` — the engine objects
  keep `_recognizer` / `_engine` set, so an orphaned reference still reports `loaded == True`.
  Nothing holds such a reference today; noting it because the name promises more than it does.
- **L6. Stale references to the deleted service.** `AGENTS.md:9` still describes "vi→en
  (ElevenLabs voice) and en→vi (local VieNeu voice via a Python sidecar)";
  `benchmarks/stt/README.md:6` points at `services/vieneu-tts`; both new service READMEs say
  "same convention as `services/vieneu-tts`". (`docs/journals/*` excluded as instructed.)
- **L7. Stale test comment.** `local-speech-providers.spec.ts:180` — "the sidecar's
  English-only guard" no longer exists.
- **L8. Redundant copies on the hot path.** `local-speech-stt-provider.ts:48` copies the whole
  Uint8Array, then `Blob` copies again, then FormData buffers. ~4× the audio size in flight per
  request. Acceptable at 9 MB, worth remembering if the body limit ever rises.

---

## Concurrency review (asked for explicitly)

**The locking is sound.** Specifically:

- No deadlock is possible. `SttEngine.transcribe` / `TtsEngine.synthesize` are the only lock
  acquisitions, they are never nested, no engine calls into another engine, and no lock is held
  across an `await` (both endpoints are `def`, not `async def`, so they run in anyio's threadpool
  and never touch the event loop).
- No cross-engine shared mutable state. The only process-wide mutation is
  `os.environ.setdefault(...)` at module import, before any engine exists.
- `KokoroEn._resolve_sid` reads `self._engine.num_speakers`, but it is called from `_infer`,
  which the base class only calls under the lock. Correct.
- `EngineRegistry._engines` is written only during lifespan startup (single-threaded, before
  the server accepts) and cleared during shutdown. A worker thread that already resolved an
  engine holds a live reference, so `unload_all()` during an in-flight request cannot produce
  a use-after-free — Python refcounting saves this by construction.
- Partial load failure does **not** leave a "healthy but broken" service: `load_all()` raises
  inside `lifespan` before the `yield`, uvicorn reports `lifespan.startup.failed` and exits.
  `ready` can never be True with a missing engine.

Two non-defects worth knowing:

- `VieNeuVi.preset_voices` (via `GET /voices`) reads `self._engine._preset_voices` **without**
  the lock, concurrently with a possible `_infer`. Safe only because that dict is populated at
  construction and never mutated. It is a private attribute of a third-party package — if
  `vieneu` ever makes it lazy, this becomes a real race. A one-line `with self._lock:` would
  make it not depend on someone else's implementation detail.
- `threading.Lock` is not FIFO-fair in CPython. Under sustained same-language load a request
  can in principle be starved. Not worth acting on at this scale.

**Open question I could not resolve from source:** whether `vieneu`'s inference releases the
GIL. sherpa-onnx does (C++ extension), so vi/en overlap works for the STT service and for
Kokoro. If `vieneu` does significant work in pure Python, the per-engine lock in local-tts buys
less than the comments claim and both engines effectively serialise on the GIL. Measurable with
two concurrent `/synthesize` calls (one per language) — worth checking before relying on the
concurrency story.

---

## Audio decode review (asked for explicitly)

`services/local-stt/audio/decode.py` is **correct**:

- `AudioResampler(format="fltp", layout="mono", rate=16000)` does downmix + resample in one
  pass; feeding a 48 kHz stereo webm/opus and getting 16 kHz mono is verified by
  `test_decode.py::test_decodes_webm_opus_to_mono_16k` against a real in-memory Opus fixture.
- `to_ndarray().reshape(-1)` is right for mono `fltp` (shape `(1, n)`).
- The flush (`resampler.resample(None)`) is present — without it you would silently truncate
  the tail. Good catch by the author.
- `except DecodeError: raise` before the broad `except Exception` correctly preserves the
  400-mapped error instead of re-wrapping it.
- `test_decoded_signal_is_not_silence` is a genuinely good test: it catches the
  right-shape-all-zeros resampler misconfiguration, which is the failure mode that would
  otherwise ship as "STT returns empty transcripts".

**Can malformed input hang or 500 instead of 400?** Not hang — the source is a `BytesIO`, so
there is no I/O wait, and PyAV's probe is bounded. Not 500 either — every PyAV exception family
is caught. The one gap is not malformedness but **size** (H3): a _well-formed_ very long file is
accepted, and that is the path that hurts.

Untested branch: "no audio stream in the payload" (`decode.py:52`). A video-only mp4 hits it
and nothing covers it.

---

## Blast radius — what still references the deleted pieces

| Reference                                   | File                                                                   | Status                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `VieNeuTtsProvider`                         | `apps/api/test/translate-en-vi-sidecar.e2e-spec.ts:1,16`               | **Broken import — H1**                                                                                         |
| `VIENEU_TTS_URL`                            | same file, L9,12                                                       | Dead env var, dead test                                                                                        |
| `services/vieneu-tts`                       | `services/local-tts/README.md:8,10`                                    | **Wrong — M1**                                                                                                 |
| `services/vieneu-tts`                       | `services/local-stt/README.md:8`                                       | Stale comment                                                                                                  |
| `services/vieneu-tts`                       | `benchmarks/stt/README.md:6`                                           | Stale comment                                                                                                  |
| VieNeu routing description                  | `AGENTS.md:9`                                                          | Stale                                                                                                          |
| `VIENEU_VOICES`                             | `packages/types/src/http/index.ts:52`, `apps/web/.../voice-picker.tsx` | **Intentional and still live** — the vi preset names remain the correct vocabulary for the `local` TTS backend |
| `makeProviders(profile, targetLang)`        | —                                                                      | No remaining 2-arg call site. Confirmed across `apps/api`, `apps/web`, `apps/mobile`                           |
| Vietnamese-output-implies-VieNeu assumption | `apps/mobile`                                                          | Does not consume `/translate` at all — no impact                                                               |
| Vietnamese-output-implies-VieNeu assumption | `apps/web`                                                             | **One live dependency — H2** (the voice picker's values are only valid for a VieNeu-backed TTS)                |

No model weights, `.venv`, or secrets are tracked — `git ls-files services/local-*` shows
source only, and both `.gitignore` files cover `models/` and `.venv/`. AC#5 met.

---

## Test quality

**Genuinely behavioural (good):**

- `local-speech-providers.spec.ts` — tests real behaviour, not shape. The three that earn
  their keep: empty transcript survives as a valid result (L85), malformed JSON body becomes
  `ProviderResponseError` (L100), and `cause` is preserved through `ProviderConnectionError`
  (L131). The "echoes the requested language rather than trusting the response" case (L71)
  is a proper trust-boundary test.
- `test_decode.py` — real in-memory Opus fixture rather than a mock. The not-silence assertion
  is the one that would actually catch a regression.
- `test_postprocess.py` — the empty/whitespace case (`""[:1].upper()`) is the exact off-by-one
  that would 500 the endpoint on silence. Correctly covered.
- `ai-providers.factory.spec.ts` "builds the local trio without any ElevenLabs key" — proves
  AC#1's real claim rather than restating the wiring.

**Close to phantom:**

- `services/local-stt/test_app.py:41` — `assert isinstance(body["text"], str)` passes if the
  endpoint hardcodes `""`. The docstring is honest about why (synthetic sweep, not speech), but
  the net effect is that **no test proves the STT sidecar transcribes anything**. The
  closed-loop TTS→STT check that does prove it exists only as prose in the delivery report.
  Recommend committing a small real-speech WAV fixture (a few seconds, one per language) and
  asserting a word appears — that is the regression that would otherwise ship silently
  (e.g. a wrong `tokens.txt`, or `espeak-ng-data` missing).
- `services/local-tts/test_app.py` `is_wav` checks — fine as a smoke test, but they would pass
  on 45 bytes of silence. Add a minimum sample count or a non-zero-amplitude assertion,
  mirroring what `test_decode.py` already does correctly.

**Missing cases that would have caught real regressions:**

1. **H2 has no test.** Nothing asserts what happens when `AI_TTS_PROVIDER=elevenlabs` and
   direction is `en_to_vi`. A pipeline spec with a fake elevenlabs TTS asserting the forwarded
   `voice` would have surfaced it immediately.
2. **M4 has no test.** `pipeline-translator.service.spec.ts` never asserts the status mapping
   for a `ProviderResponseError` carrying `status: 400`.
3. `decode.py`'s "no audio stream" branch (video-only container) — untested.
4. `local-tts` `GET /voices` with `language=fr` — the 400 branch at `app.py:72` is untested;
   only the vi and en happy paths are covered.
5. `EngineRegistry.get` raising `RuntimeError` for a known-but-unloaded language
   (`registry.py:55`) — unreachable today, untested, and would produce a 500 if reached.
6. No concurrency test in either service. Two simultaneous requests, one per language, would
   both validate the per-engine lock design and expose M3 as a number.
7. Nothing pins `LOCAL_STT_URL` / `LOCAL_TTS_URL` defaults against the ports in `dev:all`.
   Cheap assertion; a port typo currently only shows up as a 503 at runtime.

---

## Acceptance criteria

| #   | Criterion                                                                          | Verdict                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `/translate` both directions, no ElevenLabs key                                    | **Met** — factory spec proves the trio builds keyless; no code path reaches ElevenLabs when both selectors are `local`                                                                                                  |
| 2   | REST contract / provider interfaces / DTOs unchanged                               | **Met** — `packages/types/src/http/translate.ts` diff is comment-only; `TtsProvider`/`SttProvider` untouched; `audioMimeType` correctly read from `outputMimeType`                                                      |
| 3   | `elevenlabs` restores the cloud path                                               | **Partially met** — vi→en yes; **en→vi from the web UI is a hard 503 (H2)**                                                                                                                                             |
| 4   | Boots keyless/sidecar-less; failures surface at `/translate` as 503, never raw 500 | **Met.** Verified: `ProviderConfigError`, `ProviderNotImplementedError`, `ProviderConnectionError`, `ProviderResponseError` all map to 503; `BadRequestException` rethrown unchanged. Caveat M4 (400s laundered as 503) |
| 5   | No weights / secrets / `.venv` in git                                              | **Met**                                                                                                                                                                                                                 |

---

## Recommended actions, in order

1. Delete or rewrite `apps/api/test/translate-en-vi-sidecar.e2e-spec.ts` (H1). Consider adding
   `test/` to a typecheck path so this class of rot fails a gate.
2. Decide and implement the `voice`-vs-backend contract (H2). Then correct the `voice` comment
   in `packages/types/src/http/translate.ts:38`.
3. Add a duration/size bound to `decode_to_16k_mono` and a byte cap on the upload read (H3).
4. Rewrite `services/local-tts/README.md` for the post-absorb reality, and document
   `LOCAL_TTS_VOICE_EN` / `LOCAL_TTS_VOICE_VI` / `LOCAL_*_THREADS` where operators will find
   them (M1).
5. Add `AbortSignal.timeout` to both local providers (M2).
6. Map sub-500 `ProviderResponseError.status` to 400 in the pipeline (M4).
7. Commit real-speech STT fixtures so a test, not a report, proves transcription works.
8. Sweep the stale `services/vieneu-tts` references in `AGENTS.md`, `benchmarks/stt/README.md`,
   and both service READMEs (L6).

## Unresolved questions

1. Does `vieneu` release the GIL during inference? If not, the per-engine lock in `local-tts`
   is largely decorative and the two voices serialise anyway. Two concurrent `/synthesize`
   calls (one per language) would answer it.
2. Is `pnpm --filter api test:e2e` expected to be green today, or is it already a
   run-on-demand suite? That decides whether H1 is "blocking" or "clean up before it bites".
3. For H2 — is `AI_TTS_PROVIDER=elevenlabs` intended to be usable for en→vi at all, or only
   as a vi→en comparison path? If the latter, the fix is a documented constraint plus a
   startup warning rather than code.
4. Is there any supervisor planned for the sidecars in a non-`dev:all` deployment? Today a
   crashed sidecar stays crashed and the API reports 503 indefinitely with no health probe.
