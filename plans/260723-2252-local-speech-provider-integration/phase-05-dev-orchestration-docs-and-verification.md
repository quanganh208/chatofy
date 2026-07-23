---
phase: 5
title: 'Phase 5: Dev orchestration, docs, verification'
status: todo
priority: P2
effort: '2h'
dependencies: [4]
---

# Phase 5: Dev orchestration, docs, verification

## Overview

Make the whole local stack start with one command, update the documentation to
match the new architecture and its licence obligations, and prove the
end-to-end result with measured numbers instead of benchmark extrapolation.

## Requirements

- Functional: `pnpm dev:all` starts web, api, and all three sidecars.
- Functional: `pnpm knip` still passes after the `dev:all` change.
- Documentation: README, `docs/system-architecture.md`, and
  `docs/codebase-summary.md` describe the real post-change system.
- Documentation: the Zipformer-30M CC-BY-NC-ND-4.0 restriction is stated where
  a reader will actually see it.
- Evidence: measured end-to-end latency for both directions, recorded in a
  delivery report.

## Architecture

`dev:all` grows from two processes to five:

```json
"dev:all": "pnpm dlx concurrently -n web-api,vieneu,stt,tts -c blue,magenta,cyan,green \"turbo run dev\" \"uv run --directory services/vieneu-tts uvicorn app:app --port 8001\" \"uv run --directory services/local-stt uvicorn app:app --port 8002\" \"uv run --directory services/local-tts uvicorn app:app --port 8003\""
```

**`knip.json` must change in the same commit.** It currently carries
`"ignoreBinaries": ["blue,magenta"]` — knip parses `concurrently`'s `-c` colour
list as a binary name, so the entry must become
`"blue,magenta,cyan,green"` (matching the new list exactly) or `pnpm knip`
starts reporting an unlisted binary.

`pnpm dev` stays as-is (`turbo run dev`, web + api only). Since the provider
defaults are now `local`, `pnpm dev` alone no longer serves a working
`/translate` — the README must say `dev:all` is the normal command.

## Related Code Files

- Modify: `package.json` (`dev:all`)
- Modify: `knip.json` (`ignoreBinaries`)
- Modify: `README.md`
- Modify: `docs/system-architecture.md`
- Modify: `docs/codebase-summary.md`
- Create: `plans/reports/delivery-<YYMMDD-HHMM>-local-speech-integration-report.md`

## Implementation Steps

1. **`package.json`** — update `dev:all` as above.

2. **`knip.json`** — update `ignoreBinaries` to match the new colour list, then
   run `pnpm knip` to confirm.

3. **README** — update:
   - the `Structure` tree: add `services/local-stt/`, `services/local-tts/`
   - a new section describing the local speech stack (what runs where, which
     model serves which language, ports 8001/8002/8003)
   - one-time setup: `uv sync` + `python scripts/download_models.py` per sidecar
   - make `pnpm dev:all` the documented normal command; note that `pnpm dev`
     alone leaves `/translate` without providers now that the defaults are `local`
   - the provider-default change and how to switch back to cloud for comparison
   - **Model licences:** Zipformer-30M vi is CC-BY-NC-ND-4.0 → academic /
     thesis use only, no commercial use, no redistribution of derivatives.
     Moonshine-base en is MIT; Kokoro-82M is Apache-2.0. State the swap path if
     the project is ever commercialized (PhoWhisper via the same `SttProvider`
     contract, accepting ~1.3s/utterance).

4. **`docs/system-architecture.md`** — read it first, then update the provider /
   speech-pipeline sections: two new sidecars, the language→provider routing
   table (STT vi+en → local-stt; TTS en → local-tts, TTS vi → vieneu;
   translation → Gemini cloud), and the new env vars. State plainly that
   **machine translation remains cloud**, so the system is not fully offline.

5. **`docs/codebase-summary.md`** — read it first, then add the two services and
   the new provider files to the inventory.

6. **Measure end-to-end latency.** No new harness — `PipelineTranslatorService`
   already logs `stt(...) Nms`, `translate(...) Nms`, `tts(...) Nms` per turn.
   Run ~10 turns per direction through the web app with realistic utterances,
   collect the log lines, and compute p50/p95 per stage plus total.
   Compare against the benchmark expectation (vi→en ≈ STT 0.1s + MT ~1s +
   TTS ~1.2s). Investigate any stage more than ~2× its benchmarked value before
   accepting the numbers — likely causes are decode overhead, thread
   oversubscription, or a cold engine.

7. **Delivery report** in `plans/reports/` following the repo's naming
   convention: environment, measured per-stage and total latency for both
   directions, deviations from the benchmark, the PyAV-vs-ffmpeg outcome from
   Phase 1 Step 1, licence obligations, and anything left open.

8. **Full gate:** `pnpm typecheck && pnpm lint && pnpm knip` and the api test
   suite.

## Success Criteria

- [x] `pnpm dev:all` brings up five labelled processes and all three `/healthz` endpoints return 200
- [x] `pnpm knip` passes with the updated `ignoreBinaries`
- [x] A cold-clone walkthrough of the README setup steps succeeds without undocumented steps
- [x] README states the Zipformer CC-BY-NC-ND-4.0 academic-only restriction
- [x] `docs/system-architecture.md` shows the language→provider routing and says translation is still cloud
- [x] Measured p50/p95 recorded for both directions in the delivery report
- [x] `pnpm typecheck && pnpm lint && pnpm knip` clean

## Measured result (recorded during implementation)

Full numbers and findings: `plans/reports/delivery-260723-2330-local-speech-integration-report.md`.

6 turns per direction, 4s apart, 0 failures:

| Direction | p50     | p95     | STT    | Translate (cloud) | TTS              |
| --------- | ------- | ------- | ------ | ----------------- | ---------------- |
| vi→en     | 1663 ms | 1976 ms | 53 ms  | 916 ms            | 748 ms (Kokoro)  |
| en→vi     | 2337 ms | 2662 ms | 186 ms | 921 ms            | 1402 ms (VieNeu) |

The cloud translation call is now the largest single component of a vi→en turn
(~55%). Speech is no longer the bottleneck.

`pnpm dev:all` verified from cold: labels `web-api`, `vieneu`, `stt`, `tts`;
all of :8001/:8002/:8003 `/healthz` returned 200, api :3000 `/health` ok, web
:3001 HTTP 200.

## Risk Assessment

- **`knip` breaks on the colour list (Medium).** Known and easy to miss — the
  `ignoreBinaries` value looks like nonsense until you know knip is parsing
  `concurrently -c`. Handled in Step 2.
- **Five processes on Windows are noisy / port conflicts (Low).** Ports 8001–8003
  are already the documented allocation; if one is taken, the sidecar fails
  loudly at bind time.
- **Measured latency misses the benchmark (Medium).** Do not paper over it —
  the benchmark numbers are the thesis's evidence base, so a real gap is a
  finding worth recording, not a number to massage. Step 6 sets the
  investigate-first threshold.
- **Docs drift (Low).** `docs/` is small (3 files + journals); read each file
  before editing rather than assuming its structure from `CLAUDE.md`, which
  lists a larger docs tree than actually exists.
