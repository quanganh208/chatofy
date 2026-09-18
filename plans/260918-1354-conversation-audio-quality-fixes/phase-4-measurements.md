# Phase 4 — Re-measure and correct the recorded numbers

## Context

Changing the decoding method invalidates the numbers the repository publishes for
the Vietnamese engine (`5.38% WER, RTF 0.017, p95 0.09s`), which were measured
with `greedy_search`. Separately, the real-world WER on the sample conversation
is 13.4% — 2.2× the benchmark figure — because the benchmark set is read speech
and this is spontaneous livestream speech with filler, brand names and
code-switching. Both numbers are true; only one is currently written down.

## Requirements

- Re-measure with the project's own harness under the new decoding method.
- Do not corrupt the recorded benchmark results: a limited run rewrites
  `summary.json`. Write to a separate output path, or run the full set.
- Publish the real-world figure next to the benchmark figure rather than
  replacing it.

## Files

- `benchmarks/stt/**` — read first; do not overwrite recorded results
- `services/local-stt/README.md`
- `docs/development-journey.md`

## Validation

The published numbers match a run that is reproducible from the commands beside
them.
