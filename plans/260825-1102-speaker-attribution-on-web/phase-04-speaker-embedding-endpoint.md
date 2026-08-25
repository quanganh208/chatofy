---
phase: 4
title: 'Phase 4: Speaker embedding endpoint'
status: pending
priority: P2
effort: '1d'
dependencies: []
---

# Phase 4: Speaker embedding endpoint

## Overview

`POST /embed` on the local STT sidecar: audio in, one L2-normalised speaker vector out. Stateless,
and isolated from the recognizers so it cannot slow a decode.

Independent of Phases 1-3 — it touches only `services/local-stt` and can be built in parallel.

## Requirements

**Functional**

- [ ] `POST /embed` accepts the same multipart shape as `/transcribe`, minus `language`
- [ ] Returns a fixed-length float vector, L2-normalised
- [ ] `/healthz` reports the extractor's readiness alongside the recognizers'
- [ ] `scripts/download_models.py` fetches the weights, idempotently

**Non-functional**

- [ ] campplus, `num_threads=2`
- [ ] Its own extractor and its own lock — never the STT registry's
- [ ] Cold start does not regress: both recognizers load in under 2.5s today

## Architecture

**A separate endpoint, not a flag on `/transcribe`.** The prior contract's argument survives intact
and is worth restating, because "avoid a second decode" is the obvious-looking optimisation that
would break the latency constraint. Translation cannot start until it has the transcript text. If
the embedding rode along in the same response, its cost would land **before** translation — +30-100ms
for campplus, and up to +500ms for the model we did not pick. A second localhost upload of a
few-second 16k clip costs single-digit ms. The "optimisation" would buy a serialisation to save
roughly nothing.

**`num_threads=2`, not 8.** `base.py` gives each STT engine 8 threads, tuned to physical cores.
The embedding nets are small, and in production this runs beside a recognizer already claiming those
8 on an 8-core box — asking for 8 more oversubscribes. This is the value Phase 5 of the benchmark
measured contention at, so it is the value with evidence behind it.

**Its own lock, deliberately.** `registry.py` holds one lock per engine because a sherpa-onnx
recognizer is not assumed safe for concurrent use. The extractor gets the same treatment, and a
separate one: sharing a lock with the `vi` engine would make an embedding wait behind a decode,
which is precisely the serialisation this whole design avoids.

**Not an `SttEngine`.** It does not transcribe and has no language. Putting it in `_ENGINE_TYPES`
would put it behind `registry.get(language)`, whose language set is closed on purpose. It lives in
its own module and loads alongside the registry in `lifespan`.

**Ordering matters at import.** `preload_onnxruntime_dll()` must run before any `import sherpa_onnx`
— today `registry.load_all()` does that first. The extractor's load must sit after that call, not
before it, and not in a module imported at the top of `app.py`. Getting this wrong produces a hard
process abort rather than a Python exception.

**fp32 is expected.** There is no int8 variant of any speaker embedding model in the sherpa-onnx
release, unlike the ASR models. Do not self-quantise; the measured numbers are fp32.

**Normalise server-side.** Every consumer compares by cosine. Normalising once here means no caller
can forget, and an unnormalised vector reaching a threshold comparison is silent — it produces a
number, just the wrong one.

## Related Code Files

- Create: `services/local-stt/speaker/embedder.py` — warm extractor, own lock
- Create: `services/local-stt/speaker/__init__.py`
- Modify: `services/local-stt/app.py` — `/embed`, and extractor readiness in `/healthz`
- Modify: `services/local-stt/scripts/download_models.py` — fetch campplus
- Create: `services/local-stt/test_embed.py`
- Modify: `services/local-stt/test_app.py` — `/healthz` shape changed
- Modify: `docker-compose.yml` / `docker/` — only if the models bind-mount needs the new file
- Read (do not modify): `benchmarks/speaker-id/speaker_bench/embed.py` — the measured configuration
- Read (do not modify): `services/local-stt/engines/base.py`, `engines/registry.py`

## Implementation Steps

1. Add the weights to `download_models.py`:
   `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`, from the sherpa-onnx
   `speaker-recongition-models` release. **That tag is misspelled upstream — copy it verbatim; a
   corrected spelling 404s.**
2. Write `speaker/embedder.py`, mirroring `SpeakerEmbedder` in `benchmarks/speaker-id`: one warm
   extractor, `num_threads=2`, its own `threading.Lock`, `config.validate()` checked, L2-normalise
   before returning.
3. Load it in `lifespan`, after `registry.load_all()` so the DLL preload has run.
4. Add `POST /embed`: reuse `decode_to_16k_mono` and its existing error mapping (413 too long,
   400 undecodable). Return `{"vector": [...], "dim": n}`.
5. Extend `/healthz` so a loaded registry with an unloaded extractor does not report ok.
6. Tests: vector length matches the model's dimension; the vector is unit-norm; the same audio twice
   gives the same vector; two different speakers from the release's own labelled smoke clips score
   lower than two clips of one speaker; a corrupt upload is a 400 and not a 500; concurrent requests
   do not interleave into a corrupt vector.
7. Verify cold start still completes inside the existing budget and record the new number.

## Success Criteria

- [ ] `POST /embed` returns a unit-norm vector of the model's dimension
- [ ] Same-speaker cosine exceeds different-speaker cosine on the release's labelled clips
- [ ] `/healthz` is 503 while either the recognizers or the extractor are unloaded
- [ ] `download_models.py` is idempotent and leaves weights gitignored
- [ ] Concurrent `/embed` and `/transcribe` both succeed, and neither blocks on the other's lock
- [ ] Cold start recorded; no regression against today's under-2.5s
- [ ] `uv run --directory services/local-stt pytest` passes

## Risk Assessment

- **The onnxruntime shared-library breakage.** This service has a known failure where the sidecar
  crashes on import unless `libonnxruntime.so` is symlinked, and it returns after any `uv sync`.
  Signal: a hard abort on startup rather than a traceback. Response: apply the existing symlink fix;
  `scripts/link_onnxruntime.py` in the bench is the reference. This will bite during this phase
  because adding a dependency means running `uv sync`.
- **Thread oversubscription under real load.** Signal: STT p50 rises after `/embed` starts being
  called. Response: `num_threads=2` is the measured starting point, not a proven ceiling; measure
  before changing it, and treat a regression in decode latency as the signal to lower rather than
  raise it.
- **The extractor is loaded before the DLL preload.** Signal: process aborts with no Python
  traceback, most likely on Windows. Response: the load site is inside `lifespan` after
  `registry.load_all()`. Do not move the import to module scope, however tidy that looks.
- **A missing model file takes the whole sidecar down.** `/healthz` returning 503 until the
  extractor loads is what makes readiness honest, but compose gates the service on that healthcheck
  — so absent or corrupt campplus weights would stop translation entirely, an outage caused by a
  default-off enhancement. Accepted deliberately, not by omission: the failure is loud at startup
  rather than silent at runtime, and the weights sit in `download_models.py` beside the ASR models,
  so they fail the same way and get fixed the same way. Signal to revisit: a real deployment where
  the sidecar comes up without them. Response then, not now: report the extractor separately in
  `/healthz` and let `/transcribe` serve without it.
- **`/embed` inherits `/transcribe`'s audio-length cap without anyone deciding it should.** A turn
  is a few seconds; the cap exists for a different reason. Signal: the cap is copied without comment.
  Response: reuse the decoder's existing errors, and say in a comment that the cap is inherited
  deliberately, so a later reader does not treat it as tuned for this endpoint.
