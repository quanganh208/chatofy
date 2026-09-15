# The unseeded run — kept because three reports quote it

These are the per-arm JSONL files from the original `r1`/`r2` measurement, taken
before `engines/vieneu_vi.py` seeded its sampler or used `infer_stream`. They are
copied here, not moved: `results/r1` and `results/r2` have been re-measured in
place on the seeded, streaming footing, and every VieNeu number in

- `plans/reports/benchmark-260914-1135-zerotts-vs-vieneu.md`
- `plans/reports/benchmark-260914-1629-clause-split-intelligibility.md`

was computed from the files in this directory.

What makes them not comparable to the current `r1`/`r2`: VieNeu ran unseeded, so
each figure is one draw from a distribution, and its time-to-first-audio was
measured as clause-split synthesis because the adapter declared
`supports_streaming = False`. The WAVs are not archived — they are gitignored and
regenerable from the recorded seed, which is the point of recording one.
