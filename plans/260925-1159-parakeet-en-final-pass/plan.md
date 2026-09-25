# Plan — Parakeet-TDT for English finals, Moonshine kept for live partials

> **Superseded by the 25/09 13:45 update at the end:** Parakeet answers every English request; the `pass` field, `LOCAL_STT_EN_FINAL` and Moonshine were removed. The Changes, Acceptance and Rollback sections below describe the abandoned two-pass design.

Status: implemented (single English engine), PR #172 · Branch: `feat/parakeet-en-final-pass`
Decision record: `plans/reports/brainstorm-260925-1152-streaming-stt-prod-audio-evaluation.md` (winner E, step 2 "Ship A"). The maintainer accepted it on 2026-09-25.

## Outcome

English final transcripts come from Parakeet-TDT-0.6b-v2 int8 (sherpa-onnx). Live partials keep Moonshine-base, because re-decoding every 300 ms is only affordable with the cheaper model. Vietnamese is unchanged.

## Evidence gate (measured before any code, prod audio replayed through the real CapturePump)

- **Replay fidelity:** current engines on replayed turns score vi 22.3 / en 7.4, against prod's saved text at 22.1 / 7.1. For bcf4d748 the replay produces 17 turns with 8 forced cuts, exactly matching the prod log.
- **en finals on real cuts:** Parakeet 3.4 vs Moonshine 7.4 WER (whole text, vs Whisper large-v3). Paired per-turn bootstrap: −4.0 points, 95% CI [−7.3, −0.9].
- **Final decode latency:** p95 is ~315 ms, against ~205 ms today (idle host, 4 threads).
- **Memory:** Parakeet adds +0.95–1.1 GB RSS. The sidecar currently uses 884 MiB of its own 4 GB `mem_limit`.
- **Output:** punctuation and casing, like Moonshine. License CC-BY-4.0.
- **Vietnamese:** no candidate beat the current model per turn. The 70k Zipformer came out −0.3 [−1.9, +1.3], and pcs +13.7 (significantly worse).

## Changes

1. `services/local-stt`:
   - a `ParakeetEn` engine;
   - the registry resolves `(language, pass)`;
   - `/transcribe` accepts `pass` (`final` by default, or `partial`); any other value is a 400;
   - `LOCAL_STT_EN_FINAL=moonshine` rolls back, with the engine left unloaded;
   - `download_models.py` fetches the tarball;
   - tests.
2. `packages/ai-providers`: `SttTranscribeOptions.pass`; the local provider sends it and ElevenLabs ignores it.
3. `apps/api`: `TranslateTurnInput.pass`; `live-preview.ts` sends `partial`, and everything else stays final (speculation included, because its result becomes the final).
4. Docs: the STT section of `docs/system-architecture.md`, `docs/development-journey.md`, the `services/local-stt` README, and the deployment note (models must be seeded before restart).

## Acceptance

- The sidecar pytest suite and the api/ai-providers typecheck, lint and tests are green.
- A live sidecar serves both passes: partial requests are decoded by Moonshine and final ones by Parakeet, verified with a real clip.
- Under concurrent final + partial load, final p95 is at most current p95 + 300 ms, and `/healthz` stays ok.
- Rollback flag verified: with `LOCAL_STT_EN_FINAL=moonshine`, final requests go to Moonshine and Parakeet is not loaded.

## Rollback

Set `LOCAL_STT_EN_FINAL=moonshine` and restart the sidecar. No data or schema changes.

## Unresolved

- A second en reference (ElevenLabs on the 2 en recordings) is not yet approved. The gain is significant against Whisper only.
- Deploying to prod needs the maintainer's go-ahead.

## Update 25/09 13:45 — single English engine

The maintainer asked for only the best model and no rollback flag. Moonshine, the `pass` field and `LOCAL_STT_EN_FINAL` were removed; Parakeet answers every English request. Re-measured under the same two-direction load (4 threads, 4 lanes): partial p95 284ms (below the 300ms cadence), final p95 327ms, 0 503s, peak RSS 1363MB. Rollback is now a revert of the commit.
