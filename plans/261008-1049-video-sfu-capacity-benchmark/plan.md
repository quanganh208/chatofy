# Plan: Video SFU Capacity Benchmark (Issue #211)

Measure real mediasoup SFU capacity targets on production-like hardware, replacing the
assumed targets (6 participants, 720p60, VP8) in the video-conferencing docs with measured
ones. Harness lives in `benchmarks/video/`, runs against the `feat/207-mediasoup-poc`
branch, drives N headless-browser participants via Playwright, sweeps participant count ×
resolution (× with/without translation), and records SFU CPU/RAM, server bandwidth, and
client CPU per run.

- **Issue:** #211
- **Base branch:** `feat/207-mediasoup-poc` (the benchmark MUST run from this branch; it has
  `ConferenceWorkerService`, `ConferenceRoomRegistry`, `ConferenceGateway` @ `/ws/conference`)
- **Branch to open:** `feat/211-video-capacity-benchmark` off `feat/207-mediasoup-poc`
- **Timestamp:** 261008-1049

---

## Design summary (how the pieces fit)

```
docker (--memory ~3.4GiB)         Playwright driver (host laptop)
┌──────────────────────────┐      ┌───────────────────────────────────┐
│ NestJS API               │      │ sweep.ts                          │
│  ConferenceWorkerService │◄─ws──┤  for count in 2,3,4,6:            │
│  + metrics tap           │ /ws/ │   for res in 360p30,720p30,720p60:│
│    worker.getResourceUsage│ conf│    for translate in off,on:       │
│    producer/consumer      │      │     launch N headless pages       │
│    .getStats() bytes      │      │     each: fake video+audio track  │
└──────────────────────────┘      │     join room, produce, consume   │
         │ metrics WS/HTTP         │     sample metrics for WINDOW sec │
         └────────────────────────►│     write run JSON                │
                                   │  client CPU via CDP Performance   │
                                   └───────────────────────────────────┘
                                                │
                                   benchmarks/video/results/*.json + summary.csv
```

The SFU forwards, it does not transcode — so the hypothesis under test is that CPU scales
with track count (N×(N-1) consumers) and RAM with transport/consumer count, not with codec.
The benchmark is what confirms or refutes that for this hardware.

### Fake media (no camera/mic on a headless CI host)

Chromium flags, not canvas plumbing:
`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream
--use-file-for-fake-video-capture=<y4m>`. A generated Y4M at each target resolution/fps
feeds `getUserMedia`. This is simpler and more deterministic than canvas+WebAudio and is the
standard WebRTC test approach. Y4M files are generated once by a setup script (ffmpeg).

### Server metrics tap (added behind an env flag, PoC-only)

mediasoup exposes `worker.getResourceUsage()` (ru_utime/ru_stime/ru_maxrss) and
`producer.getStats()` / `consumer.getStats()` / `transport.getStats()` (byteCount, bitrate).
A thin read-only metrics endpoint on the existing `ConferenceGateway` (new
`conference.metrics` subscribe message, or a guarded HTTP route) returns a snapshot. It is
gated by `CONFERENCE_METRICS_ENABLED=1` so it never ships in a normal run. This is the only
app-code change; everything else is the standalone harness.

---

## Phases

- **Phase 1: Server metrics tap** — expose `getResourceUsage` + aggregated transport/producer/
  consumer stats from the running SFU, env-gated. Owns: `apps/api/src/modules/conference/
conference-metrics.service.ts` (new), edit `conference.gateway.ts`, `conference.module.ts`.
  Effort: M
- **Phase 2: Harness scaffold + fake media** — `benchmarks/video/` project (standalone, not in
  the pnpm/turbo workspace — same convention as `benchmarks/stt`), Playwright dep, Y4M
  generator, a minimal headless client page the driver loads. Owns: `benchmarks/video/package.json`,
  `tsconfig.json`, `scripts/generate-fixtures.ts`, `client/bench-client.html`+`.ts`. Effort: M
- **Phase 3: Single-run driver** — launch N pages, join one room, each produces fake A/V and
  consumes peers, hold for a sample window, collect server + client metrics, write one run
  JSON. Owns: `benchmarks/video/src/run-once.ts`, `src/metrics.ts`, `src/client-cpu.ts`. Effort: L
- **Phase 4: Sweep automation + docker cap** — iterate count × resolution × translate, bring
  the API up under `docker --memory`, aggregate run JSONs into `summary.csv`. Owns:
  `benchmarks/video/src/sweep.ts`, `scripts/run-capped-api.sh`, `results/.gitkeep`. Effort: M
- **Phase 5: Translation-on sweep wiring** — drive the existing `/ws/translate` path per speaker
  during the sweep (as #209 wired it into the PoC) so every run has a with-translation twin.
  Owns: `benchmarks/video/src/translate-load.ts`, extends `run-once.ts`. Effort: M
- **Phase 6: README + docs sync** — `benchmarks/video/README.md` (rerun instructions), update
  Open Decision 4 in `docs/video-conferencing-architecture.md`, update risk matrix in
  `docs/technical-risks-mitigation.md`. Owns those three files. Effort: M (blocked on real runs)

---

## Feasibility

- **Complexity:** complex (headless WebRTC at N participants, docker memory cap, two
  metric domains, a translation twin sweep — but each phase is independently verifiable)

### Reuse Ledger

| #   | Capability                                                          | Verdict | Evidence                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Benchmark project layout (standalone, README + results/ + scripts/) | REUSE   | `benchmarks/stt/`, `benchmarks/speaker-id/` structure; README convention at `benchmarks/stt/README.md`                                                                                   |
| 2   | SFU signaling contract (join/transport/produce/consume)             | REUSE   | `conference.gateway.ts` `@SubscribeMessage` handlers on `feat/207-mediasoup-poc`; `conference.produce` accepts `appData`                                                                 |
| 3   | mediasoup client flow (Device, transports, produce, consume)        | REUSE   | `apps/web/app/(app)/conference-poc/page.tsx` — harness client page adapts this                                                                                                           |
| 4   | Fake video/audio for headless Chromium                              | REPLACE | Issue proposed canvas+WebAudio; use Chromium `--use-file-for-fake-video-capture` Y4M instead (simpler, deterministic) — scope: `benchmarks/`, reviewed PoC page uses real `getUserMedia` |
| 5   | SFU resource metrics (CPU/RAM)                                      | REUSE   | mediasoup `worker.getResourceUsage()` API exists per issue; `ConferenceWorkerService.getWorker()` already exposes the Worker                                                             |
| 6   | Server bandwidth (bytes sent/recv)                                  | REUSE   | mediasoup `transport.getStats()` / `producer.getStats()` / `consumer.getStats()` — transports held in `PeerState` (`conference-room-registry.service.ts`)                                |
| 7   | Translation load path                                               | REUSE   | `/ws/translate` gateway exists; #209 wired it into the conference PoC — harness drives the same WS per speaker                                                                           |
| 8   | docker memory cap                                                   | REUSE   | `docker run --memory` / compose `mem_limit`; compose already caps redis memory (`docker-compose.yml`)                                                                                    |
| 9   | Playwright driver + Y4M generator                                   | NEW     | reuse-search: not-found-after-corpus-and-grep<br>scope: `benchmarks/ package.json apps/*/package.json`                                                                                   | swept: 2026-10-08 (playwright only in `apps/extension`, not a benchmark driver; no Y4M/WebRTC-load harness exists) |

---

## Dependencies

- **Blocks:** Phase 6 doc updates are blocked by actual sweep runs (Phases 3–5 producing data).
- **Blocked by:** all phases blocked by checking out `feat/207-mediasoup-poc` (the only branch
  with the conference module). Phase 3 blocked by Phases 1+2. Phase 4 blocked by Phase 3.
  Phase 5 blocked by Phase 3. Phase 6 blocked by 4+5.
- **Critical path:** 1 → 2 → 3 → 4 → 5 → 6.
- **Parallel-safe:** Phase 1 (app code) and Phase 2 (harness scaffold) touch disjoint files and
  can run concurrently.

---

## Risk Assessment

| Risk                                                                                                      | Likelihood (1-5) | Impact (1-5) | Score | Mitigation                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------- | ---------------- | ------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UDP media blocked without TURN on non-localhost; harness can't establish media                            | 3                | 5            | 15    | Run harness + API on the SAME host (loopback) — PoC confirmed loopback works without TURN. Only go cross-host if explicitly needed; then use the existing coturn service. Document the loopback constraint in README.          |
| Client CPU (N headless Chromium) saturates the driver laptop, polluting SFU readings                      | 4                | 4            | 16    | Run driver browsers on a SEPARATE machine from the capped API, OR cap browser count and record driver CPU alongside so saturation is visible, not silent. State sample size + per-page CPU in every run JSON. Smoke N=2 first. |
| `worker.getResourceUsage()` reports per-Worker, not per-container; misattributes RAM under the docker cap | 3                | 3            | 9     | Record BOTH `getResourceUsage().ru_maxrss` AND container RSS (`docker stats --no-stream` / cgroup `memory.current`) per run; the container figure is the one compared against the 3.4 GiB headroom.                            |
| Measured capacity contradicts the assumed 6/720p60 target → doc rewrite scope grows                       | 3                | 2            | 6     | That is the point of the issue. Phase 6 records measured numbers as-is with method; does not force-fit the old target.                                                                                                         |
| mediasoup H264 present in router codecs may be negotiated instead of VP8, confounding the codec variable  | 2                | 3            | 6     | Pin VP8 in the harness client's `produce` encodings / device codec selection; assert the negotiated codec in each run JSON.                                                                                                    |
| Fake Y4M at 720p60 not actually delivered at 60fps by Chromium fake capture                               | 2                | 3            | 6     | Verify captured frameRate via `track.getSettings()` and RTCStats `framesPerSecond`; record actual vs target fps in run JSON (measured, not assumed).                                                                           |

**No risk ≥ 15 is left unmitigated.** The two 15/16 risks (TURN, driver CPU) both require the
run-topology decision below before Phase 3 starts.

---

## Timeline

| Phase                            | Effort           | Notes                                       |
| -------------------------------- | ---------------- | ------------------------------------------- |
| 1. Server metrics tap            | M                | parallel with Phase 2                       |
| 2. Harness scaffold + fake media | M                | parallel with Phase 1                       |
| 3. Single-run driver             | L                | blocked by 1+2; smoke at N=2 before scaling |
| 4. Sweep automation + docker cap | M                | blocked by 3                                |
| 5. Translation-on sweep          | M                | blocked by 3                                |
| 6. README + docs sync            | M                | blocked by real runs from 4+5               |
| **Total**                        | **~2.5 L-equiv** | Critical path: 1→3→4→5→6                    |

---

## Verification per phase

| Phase | Pass/fail check                                                                                                                                                                                           |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `CONFERENCE_METRICS_ENABLED=1` + `curl`/WS `conference.metrics` returns JSON with `cpuUserMs`, `maxRssBytes`, `bytesSent`, `bytesRecv`; unset env → endpoint 404/absent. `pnpm --filter api build` green. |
| 2     | `cd benchmarks/video && pnpm i && pnpm generate-fixtures` produces Y4M files at each resolution; `bench-client.html` loads headless and logs `getUserMedia` success.                                      |
| 3     | `pnpm run-once --count 2 --res 360p30` writes one `results/*.json` with non-zero `bytesSent`, both peers' video consumed (frame count > 0), negotiated codec == VP8.                                      |
| 4     | `scripts/run-capped-api.sh` starts API with cgroup memory limit == ~3.4GiB (assert `docker inspect`); `pnpm sweep` emits one JSON per (count×res×translate) cell + `summary.csv` with all rows.           |
| 5     | A translate-on run JSON shows translation WS traffic recorded and SFU CPU delta vs its translate-off twin.                                                                                                |
| 6     | README rerun steps executed end-to-end from clean checkout reproduce a run; Open Decision 4 and the risk matrix cite measured numbers with the `benchmarks/video/results/` path.                          |

---

## Rollback

- Phases 1 (app code) is env-gated and additive — revert the three conference files; no runtime
  behavior changes when `CONFERENCE_METRICS_ENABLED` is unset.
- Phases 2–5 are a standalone directory outside the workspace — deleting `benchmarks/video/`
  is a clean rollback with no app impact (mirrors `benchmarks/stt` isolation).
- Phase 6 doc edits are revertible per-file.

---

## File ownership (no file owned by two phases)

| File                                                                                                          | Phase |
| ------------------------------------------------------------------------------------------------------------- | ----- |
| `apps/api/src/modules/conference/conference-metrics.service.ts` (new)                                         | 1     |
| `apps/api/src/modules/conference/conference.gateway.ts` (edit: add metrics subscribe)                         | 1     |
| `apps/api/src/modules/conference/conference.module.ts` (edit: provide metrics service)                        | 1     |
| `benchmarks/video/package.json`, `tsconfig.json`                                                              | 2     |
| `benchmarks/video/scripts/generate-fixtures.ts`                                                               | 2     |
| `benchmarks/video/client/bench-client.{html,ts}`                                                              | 2     |
| `benchmarks/video/src/run-once.ts`, `src/metrics.ts`, `src/client-cpu.ts`                                     | 3     |
| `benchmarks/video/src/sweep.ts`, `scripts/run-capped-api.sh`, `results/.gitkeep`                              | 4     |
| `benchmarks/video/src/translate-load.ts` (+ extend `run-once.ts` — sequenced after Phase 3)                   | 5     |
| `benchmarks/video/README.md`, `docs/video-conferencing-architecture.md`, `docs/technical-risks-mitigation.md` | 6     |

Note: `run-once.ts` is extended in Phase 5; Phase 5 MUST run after Phase 3 commits (sequenced,
not parallel) to avoid two phases editing it.
</content>
</invoke>

---

## Unresolved — operator must answer before Phase 3 begins

These two could not be routed through `AskUserQuestion` (the tool is neither loaded in this
planning session nor resolvable via `ToolSearch` — a session-config limitation, flagged as a
skill-bug). They are left explicitly OPEN rather than assumed, because each changes Phase 3 and
the two highest risks hang on the first:

1. **Run topology.** Driver browsers + capped API on ONE machine (simplest, loopback, no TURN;
   but N headless Chromium contend for CPU with the SFU and can pollute readings), or driver on
   a SEPARATE machine from the capped API (clean SFU readings; needs the coturn TURN relay since
   Cloudflare Tunnel blocks UDP)? This decides the TURN risk (score 15) and the driver-CPU risk
   (score 16).
2. **Sample window + repeats per cell.** How long to hold each run at steady state (e.g. 60s) and
   how many repeats per cell for a median. Full grid = 2,3,4,6 × {360p30,720p30,720p60} ×
   {translate off,on} = 24 cells × repeats; repeats drive total wall-clock.

A clean smoke at N=2 (per `preview-first-batch`) runs before the full 24-cell sweep regardless.
