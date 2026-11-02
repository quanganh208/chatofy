# call-budget harness

What a turn costs in paid model calls, read off the API log.

Measurement-only, **not** part of the pnpm/turbo workspace and never imported by
the app — same convention as `benchmarks/error-analysis` and
`benchmarks/live-translate`.

## What it reads

Every paid model request the translation host makes writes one line
(`apps/api/src/modules/translate/providers/llm-call-log.ts`):

```
llm kind=translate purpose=speculation host=commandcode model=deepseek/deepseek-v4-flash-fast ms=1878 ok=1 in=412 out=31 cached=384 h=a1b2c3d4
```

- `kind`: `translate`, `polish`, `respell`, `fusion`, `homophones` or `digest`.
- `purpose`: the lane of a translation (`live`, `speculation`, `final`, `retry`, `block`, `chat`); `-` for other kinds.
- `in`, `out`, `cached`: token counts from the response's `usage`, or `-` when the host did not report them. Streamed translations only carry them on hosts configured with `reportStreamUsage`.
- `h`: the first 8 hex chars of a hash of the model and the messages, so identical prompts can be counted. No text is ever logged.

`analyze.mjs` also reads the `TurnMetricsRecorder` turn lines (`translated=`, `speculation=hit|miss/K`), the `session.start` lines, the `homophones(…) accepted=N` lines and `correction late, dropped`.

## Running it

Always bound the window. An unbounded `docker logs` streams the whole file, and
rotated json-file logs can silently return an older file.

```bash
docker logs chatofy_prod_api --since 2026-11-02T03:00:00Z --until 2026-11-02T03:20:00Z 2>&1 \
  | node benchmarks/call-budget/analyze.mjs > benchmarks/call-budget/results/<tag>/summary.md

node --test benchmarks/call-budget/analyze.test.mjs
```

The summary prints `turns=`, `starts=`, `calls/turn=`, billed tokens per turn,
p50/p95 `translated=`, a table by `kind/purpose`, duplicate prompts, wasted
speculation, accepted homophone corrections and late corrections.

`starts=` counts distinct `session.start` ids. One is logged per turn, so in a
replay window it must match the number of turns the replay sent; more means
someone else used prod during the window.

Nothing under `results/` is committed.
