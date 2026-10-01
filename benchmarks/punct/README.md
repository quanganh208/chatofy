# punct benchmark

Measurement-only harness ranking the Vietnamese punctuation and case restorers
the local-stt sidecar could use for the display (`POST /restore`). Standalone
`uv` project, never imported by the app — same convention as `benchmarks/stt`.

Only non-generative taggers are candidates: a restorer may case a word and put
a mark after it, never add, drop or rewrite one. The contract, arms and the
decision rule fixed before the full run are in
`plans/261001-1431-vi-punct-case-model-benchmark/plan.md`.

## Run

```bash
cd benchmarks/punct
uv sync --all-groups
uv run python -m punct_bench.rulers          # data/rows-*.jsonl (downloads FLEURS, ViCapPunc)
uv run python -m punct_bench.run --smoke 5   # results/smoke/, never the recorded results
uv run python -m punct_bench.run             # every arm, every row, 4 threads
uv run python -m punct_bench.score           # results/summary.json + table
uv run --group dev pytest
```

Each arm runs in its own process; peak RSS is sampled over that process tree.

## Rulers

| ruler     | rows | reference                                                             | input                   |
| --------- | ---- | --------------------------------------------------------------------- | ----------------------- |
| prod      | 36   | Scribe transcript of 7 prod sessions (commercial ASR, not human gold) | the live ASR hypothesis |
| aiwho     | 17   | hand-written "ai" = who / "AI" pairs                                  | lowercased reference    |
| fleurs    | 347  | FLEURS vi test `raw_transcription` (human, read Wikipedia sentences)  | lowercased reference    |
| vicappunc | 500  | ViCapPunc test (human, forum Q&A), ~40-word windows, seed 7           | lowercased reference    |

All marks reduce to three classes, `.` `,` `?` (`!` `…` → `.`, `;` `:` → `,`),
so models with different mark sets compare on the same footing.

## Metrics

Punctuation F1 (micro and per mark), case F1, proper nouns, mid-sentence
capitals per 1k words (a capital on a word the prediction does not itself open a
sentence with — "Anh, Xin"), AI and false AI, rows whose words changed, latency
p50/p95 and peak RSS. Definitions are in `punct_bench/score.py`.

The decision score is the mean of case F1 and punctuation F1 over `prod` and
`fleurs`. Each arm's difference from the incumbent comes with a 95% paired
bootstrap interval over rows.
