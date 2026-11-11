# latency harness

Where a `/translate` turn spends its time between the endpoint and the first
translated audio, stage by stage, read off the API log.

Measurement only, **not** part of the pnpm/turbo workspace and never imported
by the app, like `benchmarks/call-budget`.

## What it reads

Every turn writes one `TurnMetricsRecorder` line
(`apps/api/src/modules/translate/services/turn-metrics.recorder.ts`). Its tail
carries the stage timings:

```
turn <sessionId> ok firstAudio=912ms translated=-40ms clauses=1/stream speculation=hit/2 live=1 final=speculation … lastAudio=2400ms stages=sttDone:-310,alternateWait:62,mtFirstToken:-180,mtDone:-40,lineSent:12,embeddingDone:95,ttsRequested:96 inflight=no corrLate=no cand=no fused=1
```

- Every stage is ms from the moment the server received `end()`. A stage a
  reused speculation reached first is negative. `alternateWait` is a duration:
  how long the STT sidecar held its answer for the second recognizer.
- Stages appear in a fixed order and are skipped when the turn never reached
  them. `mtFirstToken` is the primary target's first streamed token.
- `inflight=yes` means the reused speculation was still running at `end()`.
  `corrLate=yes` means the transcript checks missed their grace.
- `cand=yes|no` says whether `end()` found the audio could hold a change of
  voice (a split candidate). A candidate takes the split path whether or not it
  is finally split; `final=split` marks the ones that were.
- `fused=N` is how many recognizer-fusion corrections the final line carried:
  0 when the fusion ran and none reached the line, absent when it never ran.

**Split turns carry no `sttDone`, `mtDone` or other recognition and
translation stages.** Their pieces are translated one by one, and only
`lineSent`, `embeddingDone` and `ttsRequested` are marked for them. They have
no `mtDone`, so they drop out of every gate cell.

No line carries transcript text, and neither do the rows or the report.

## Running it

1. Replay the recordings against an API. With voice on, the first audio is
   what is measured; with voice off, the final line (`lineSent`) is.

   ```bash
   cd apps/api && npx tsx ../../benchmarks/latency/replay-latency.mts \
     --api http://127.0.0.1:4000 --token-file "$SCRATCHPAD/owner-token" \
     --voice on --run-tag baseline-voice
   npx tsx ../../benchmarks/latency/replay-latency.mts --help   # every flag
   ```

   It refuses to start when `results/<run-tag>/rows.jsonl` already exists, so
   two runs are never mixed under one tag. It writes `results/<run-tag>/rows.jsonl` (one row per turn: the server's
   session id, the source language, timings and outcome) and
   `results/<run-tag>/window.json`, and prints `window-start=` and
   `window-end=` in UTC.

2. Save the API log for that window beside the rows. Always bound the window:
   an unbounded `docker logs` streams the whole file.

   ```bash
   docker logs chatofy_prod_api --since <window-start> --until <window-end> 2>&1 \
     > benchmarks/latency/results/<run-tag>/api.log
   ```

3. Print the tables, or evaluate a gate.

   ```bash
   node benchmarks/latency/analyze-latency.mjs --run baseline-voice
   node benchmarks/latency/analyze-latency.mjs --gate open-phase2 --baseline baseline-voice
   node benchmarks/latency/analyze-latency.mjs --gate phase2 --baseline baseline-voice --run phase2-voice
   node benchmarks/latency/analyze-latency.mjs --self-test
   ```

Only turn lines whose session id is in `rows.jsonl` are counted, so anyone
else's turns in the window are left out. The rows supply each turn's source
language, which the log line does not carry; the direction is `vi→en` or
`en→vi` from it.

## The tables

p50 and p95 per stage, per cell of `speculation=hit|miss` × direction ×
`final=split` or not. Every cell prints its n. The derived columns are:

- `restoreAndCorrections` = `translationsReady − mtDone`
- `embeddingAfterLine` = `max(0, embeddingDone − lineSent)`
- `embeddingAfterMt` = `max(0, embeddingDone − mtDone)`
- `mtStream` = `mtDone − mtFirstToken`

`firstAudio` counts only voiced, delivered turns: a `voice_off` or
`engine_busy` row has no first audio. Above the tables: per-stage coverage, the
count of `corrLate=yes`, the count of `alternateWait` ≥ 100 ms, the share of
split candidates (`cand=yes`) beside the count actually split, and the count of
turns with `fused` > 0.

## Gates

`--gate <name>` prints `PASS`, `FAIL` or `INSUFFICIENT` with the numbers, and
exits 0, 1 or 2. A cell with fewer than 15 turns is `INSUFFICIENT`. Turns
without `mtDone` are left out of every gate cell. The plain-path cells read
only `cand=no` turns, because the speech and embedding changes touch nothing
else. The conditions are the
`GATES` table in `analyze-latency.mjs`, one row per gate, copied from the plan's
phase files:

| gate          | condition                                                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open-phase2` | `cand=no` miss: `restoreAndCorrections` p50 ≥ 100 ms; prints the split-candidate share                                                                                 |
| `open-phase3` | `cand=no`, hit or miss cell: embedding wait p50 ≥ 50 ms (`--phase2-shipped` measures from `mtDone`)                                                                    |
| `open-phase4` | vi miss: `alternateWait` p50 ≥ 80 ms                                                                                                                                   |
| `open-phase5` | miss: `mtStream` p50 ≥ 400 ms                                                                                                                                          |
| `phase2`      | `cand=no` miss: first audio drops ≥ 70% of the baseline `restoreAndCorrections`; `lineSent` rises ≤ 20 ms; the share of `corrLate=yes` turns in the cell does not rise |
| `phase3`      | `cand=no`, each cell whose baseline embedding wait was ≥ 50 ms: first audio drops ≥ 70% of it; any cell under 15 turns makes it INSUFFICIENT                           |
| `phase4`      | vi miss: `lineSent` drops ≥ 70% of the baseline `alternateWait`; turns with `fused` > 0 stay ≥ 90% of baseline                                                         |
| `phase5`      | miss rows with `multiClause: true`: first audio drops ≥ 200 ms; `spokenMatchesLine` true on every row without `restart`                                                |
| `phase6`      | baseline `engine_busy` ≥ 5% (else the harness does not show the problem); run `engine_busy` < 5%                                                                       |

`phase5` reads `multiClause`, `spokenMatchesLine` and `restart` from the rows.
The replay does not write them yet; the clause-streaming change adds them.
`phase6`'s container restarts and memory peaks are checked by hand.

Nothing under `results/` is committed.
