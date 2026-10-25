# Video SFU Capacity Benchmark

> **Issue #211** — Measures real mediasoup SFU performance to back (or replace) the
> assumed targets in `docs/video-conferencing-architecture.md` Open Decision 4.

---

## What this measures

- **mediasoup worker CPU** (`worker.getResourceUsage()` — per-2s delta)
- **mediasoup worker RSS** (from `ru_maxrss`)
- **Bytes sent/received** (aggregated across all WebRTC transports)
- **API process CPU + memory** (via `pidusage` on the host API process)
- **Client CPU proxy** (Chrome DevTools Protocol `Performance.getMetrics`)

### Grid

| Participants | Resolutions            | Repeats | Total runs |
| ------------ | ---------------------- | ------- | ---------- |
| 2, 3, 4, 6   | 360p30, 720p30, 720p60 | 2 each  | 48         |

### Topology note (CPU contention)

Driver (Playwright) and API run on the **same machine** (loopback, no TURN needed).
N headless Chromium instances contend with the mediasoup worker for CPU, so the
measured SFU CPU figures are **pessimistic** (upper bound). See the `notes` column
in `results/summary.csv` for per-run context.

---

## Prerequisites

1. Node.js 20+
2. `pnpm` (or `npm`)
3. `ffmpeg` on PATH (for Y4M fixture generation — optional; Chromium fake device
   works without Y4M files)
4. The NestJS API running with conferencing and its metrics tap enabled:

```sh
# From the project root:
CONFERENCE_ENABLED=true CONFERENCE_METRICS_ENABLED=1 pnpm --filter api start:dev
```

5. One bench account per peer. The gateway keeps one socket per user in a room
   (a second join by the same user replaces the first), so peer `i` signs in as
   the `i`-th account — `bench@dev.local`, `bench+2@dev.local`, … The runner
   creates each run's room through `POST /conference`:

```sh
BENCH_PASSWORD=<password> BENCH_USERS=6 node apps/api/scripts/create-bench-user.cjs
```

---

## Install

```sh
cd benchmarks/video
npm install           # or pnpm install
npm run install-browsers   # installs Playwright's Chromium
```

---

## Generate Y4M fixtures (optional)

Used with `--use-file-for-fake-video-capture` for deterministic input.
Chromium's built-in fake device (`--use-fake-device-for-media-stream`) works
without them for most measurements.

```sh
npm run generate-fixtures
# Output: fixtures/fake-640x360-30fps.y4m  etc.
```

---

## Smoke test (N=2 before full sweep)

Per `preview-first-batch.md`: always smoke at the smallest cell first.

```sh
# Start API (separate terminal):
CONFERENCE_ENABLED=true CONFERENCE_METRICS_ENABLED=1 pnpm --filter api start:dev

# Run one cell:
API_BASE_URL=http://localhost:3000 \
API_WS_URL=ws://localhost:3000/ws/conference \
BENCH_PASSWORD=<password> \
SAMPLE_WINDOW=10 \
  npm run run-once -- --count 2 --res 360p30

# Check results/:
ls results/
cat results/run-*.json | head -40
```

Expected output in the JSON:

- `peerStates[].finalStatus === "running"` for all peers
- `peerStates[].negotiatedCodecs.video === "video/VP8"` (codec assertion)
- `server.bytesSentMB > 0`
- `server.transportCount === 4` (2 peers × 2 transports each)

---

## Full sweep

```sh
SWEEP_REPEATS=2 \
API_BASE_URL=http://localhost:3000 \
API_WS_URL=ws://localhost:3000/ws/conference \
BENCH_PASSWORD=<password> \
  npm run sweep
```

Results land in `results/*.json` (one per run) and `results/summary.csv`.

### With Docker memory cap (~3.4 GiB)

```sh
# Start capped API container (builds image if needed):
bash scripts/run-capped-api.sh

# Wait for boot (~5s), then verify:
curl http://localhost:3000/health
curl http://localhost:3000/conference/metrics   # requires CONFERENCE_ENABLED=true and CONFERENCE_METRICS_ENABLED=1

# Run sweep pointing at the container:
API_BASE_URL=http://localhost:3000 \
API_WS_URL=ws://localhost:3000/ws/conference \
BENCH_PASSWORD=<password> \
  npm run sweep

# Stop container:
bash scripts/run-capped-api.sh --stop
```

---

## Translation sweep

The automated translation sweep requires real audio (synthetic Chromium tracks
are near-silent and produce negligible STT load). See
`src/sweep-with-translation.ts` for the manual collection path.

To run a manual translation comparison:

1. Start the API with `CONFERENCE_ENABLED=true CONFERENCE_METRICS_ENABLED=1`.
2. Open the conference PoC page in N browsers with real microphones and enable
   translation per speaker.
3. Collect a 30s server metrics snapshot while the room is active:

```sh
API_BASE_URL=http://localhost:3000 \
  node --loader ts-node/esm src/sweep-with-translation.ts "4p-720p30-translate-on"
```

4. Compare the resulting JSON against the non-translation run for the same cell.

### Peak memory with translation

Peak RSS with translation running has not yet been measured (PLACEHOLDER rows
in `results/summary.csv`). Once measured, this section will state whether it
fits within the 3.4 GiB production headroom. Until then:

> Status: **not yet measured**. Run the manual collection steps above, then
> compare `server.workerRssKB` against the non-translation baseline. If
> `workerRssKB` exceeds ~3,200,000 KB (3.1 GiB) with the API's base footprint,
> the combination does not fit in the stated headroom.

---

## CSV columns

| Column         | Description                                              |
| -------------- | -------------------------------------------------------- |
| `participants` | Number of peers in the room                              |
| `resolution`   | Target resolution+fps                                    |
| `fps`          | Target frame rate                                        |
| `run`          | Repeat index (1-based)                                   |
| `workerCpuPct` | mediasoup worker user-CPU % (avg over sample window)     |
| `workerRssKB`  | mediasoup worker RSS KB (from `ru_maxrss`, avg)          |
| `apiCpuPct`    | API process CPU % via pidusage (0 if PID unknown)        |
| `apiMemMB`     | API process RSS MB via pidusage                          |
| `bytesSentMB`  | Total bytes written across all transports (last sample)  |
| `bytesRecvMB`  | Total bytes received across all transports (last sample) |
| `notes`        | `loopback-1machine` or error description                 |

---

## Caveats

- **Same-machine topology** — Playwright pages + mediasoup worker share one CPU.
  SFU CPU readings are an upper bound; real-world numbers (driver on separate
  machine) would be lower.
- **Authentication** — The bench client passes a JWT as the WebSocket subprotocol.
  In dev, configure the API to accept a shared test token or use a real JWT from
  your auth flow.
- **Windows hosts** — `ru_maxrss` from mediasoup on Windows may return 0;
  use `apiMemMB` (pidusage) as the primary memory metric on Windows.
- **Chromium fake device** — Resolution is requested via `getUserMedia` constraints
  but may be downscaled by the OS media stack. Actual resolution is recorded in
  `peerStates[].actualVideoSettings`.

---

## Files

```
benchmarks/video/
├── package.json
├── tsconfig.json
├── README.md                         ← this file
├── client/
│   └── bench-client.html             ← headless mediasoup client page
├── fixtures/                         ← Y4M files (generated, gitignored)
├── results/
│   ├── .gitkeep
│   └── summary.csv                   ← PLACEHOLDER rows until sweep runs
├── scripts/
│   ├── generate-fixtures.ts          ← ffmpeg Y4M generator
│   └── run-capped-api.sh             ← docker memory-capped API starter
└── src/
    ├── metrics.ts                    ← server + OS metrics collector
    ├── client-cpu.ts                 ← CDP client-CPU collector
    ├── run-once.ts                   ← single-run driver
    ├── sweep.ts                      ← full grid sweep
    └── sweep-with-translation.ts     ← manual translation collection
```

---

## Reproducibility

All measurements are reproducible from a clean checkout of
`feat/211-video-capacity-benchmark` by following the steps above. The
`results/summary.csv` file in this commit contains placeholder rows; run
`pnpm sweep` to fill them with real numbers.
