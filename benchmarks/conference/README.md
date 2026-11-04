# Meeting ruler

Is a meeting's translation fast, complete and as good as `/translate`? Production records no meeting timing or audio, so this is the only clock.

Measurement-only: not in the pnpm workspace and never imported by the app. `data/` and `results/` are gitignored because they hold private conversations.

## What runs

`replay-meeting.mts` runs the shipped speaker leg for each speaker, on real `/ws/translate` and `/ws/conference` sockets, in one process, so speaker and listener share a clock. Each speaker plays one whole single-language recording. There is no SFU on this path. Because no two recordings are a real dialogue, a run does not exercise handoffs.

- `turn-taking`: one speaker holds the floor for 20 s, then the next.
- `overlap`: everyone talks at once. The worst case, not a normal meeting.

## Steps

1. Decode the recordings in `corpus.json` from `translation-judge/data/audio/<id>.webm` to `data/<id>.wav`: mono, 48 kHz, 16-bit, at most 300 s. The host has no ffmpeg; use PyAV.
2. Run a meeting, from `apps/api`, one token file per speaker. Files must be mode 600. One account per speaker, because a user joining twice replaces the first socket.

   ```bash
   npx tsx ../../benchmarks/conference/replay-meeting.mts --api http://127.0.0.1:3000 \
     --token-file "$A" --token-file "$B" --pair 0 --arm turn-taking --seconds 300 --run-tag <tag>
   ```

   `--watch-prod` polls `chatofy_prod_local_stt` every 5 s and stops the run with exit code 3 above 4 GiB. Never load-test the production sidecars: a 96 s `/transcribe` once OOM-killed one.

3. `node benchmarks/conference/analyze.mjs --run <tag>` writes `summary.json` and prints the table.
4. `node benchmarks/conference/export-judge-rows.mjs --run <tag> [--polished]` writes judge rows and prints the word error against Scribe. Then follow `benchmarks/translation-judge/README.md`.

For the comparison, run the same audio through `/translate` as a meeting leg would, one-way:

```bash
npx tsx ../../benchmarks/call-budget/replay-recordings.mts --api … --token-file "$A" \
  --conversations-dir ../../benchmarks/conference/data --ids <ids> --one-way vi:en,en:vi --run-tag <tag>
node benchmarks/conference/export-judge-rows.mjs --run <tag> --results benchmarks/call-budget/results --polished
```

Its rows are per turn, like a meeting's, so a `/translate` block retranslation is not in them.

## What the numbers mean

| Field               | Measured from               | To                                                             |
| ------------------- | --------------------------- | -------------------------------------------------------------- |
| `subtitleLag`       | The server's turn start     | The listener's first non-empty line                            |
| `audioLag`          | The client closing the turn | The listener's first audio frame                               |
| `lossRate`          |                             | Turns with no final that were not empty, over all spoken turns |
| `finalDeliveryRate` |                             | Finals that reached the listener                               |

`audioLag` starts at the client's close because that is the nearest thing to "speech ended" it has: a hangover cut closes one hangover after the last word.
