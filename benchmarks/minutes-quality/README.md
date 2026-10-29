# Minutes quality harness

How useful and how faithful the minutes are that the shipped summarizer writes. `minutes-injection` checks that the summarizer cannot be talked into obeying a transcript. This harness checks whether what it writes is any good.

```bash
pnpm --filter @chatofy/ai-providers build   # the harness loads dist/, not src/
node benchmarks/minutes-quality/run.mjs --arm commandcode
node benchmarks/minutes-quality/run.mjs --arm gemini
node benchmarks/minutes-quality/score.mjs benchmarks/minutes-quality/results/<baseline> benchmarks/minutes-quality/results/<candidate> --gate
```

| Flag        | Default                                        | Notes                                                              |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| `--arm`     | required                                       | `commandcode` or `gemini`; the hosts in `../minutes-providers.mjs` |
| `--repeats` | `2`                                            | Answers vary between runs                                          |
| `--corpus`  | `all`                                          | `synthetic` skips the real conversations                           |
| `--model`   | `gemini-3.5-flash` / `google/gemini-3.7-flash` | One model, pinned: the API's flash→lite ladder is off              |
| `--gap-ms`  | `8000` for gemini, `0` otherwise               | Half a free Gemini key's per-model ceiling                         |
| `--out`     | `results/<YYMMDD-HHMM>-<arm>`                  | Must not exist; a run never writes into an older one               |

The harness takes `GEMINI_API_KEY` and `COMMAND_CODE_API_KEY` from the environment first, or else from `apps/api/.env`. It never prints them. The judge always runs on Command Code.

## What it does

1. **Generate.** It drives the shipped provider for one host (`makeMinutesProvider`), so it measures the prompt production sends. The API's failover from Command Code to Gemini is not reproduced, because each arm measures exactly one host. The drafting model is pinned as well. In production Gemini drops from flash to flash-lite whenever the free tier cools flash down, and the first comparison run this way mixed models in 11 of 18 pairs: it failed the gate on a prompt change that had not altered what flash writes. Every row records its model, and `score.mjs` warns when a pair mixes two.
2. **Judge.** `claude-sonnet-5-5` grades each minutes object on its own against an accurate reference transcript. It never sees the host or the model name. The rubric scores five things from 1 to 10 and counts one:
   - **faithfulness**: is every claim supported by the transcript?
   - **coverage**: is the important content captured?
   - **language**: is every string natural, correct text in the requested language?
   - **usefulness**: would a participant find the minutes accurate and helpful?
   - **speakerAttribution**: do owners and who-said-what match the speaker labels?
   - **hallucinations**: how many distinct claims, decisions, owners or dates are unsupported?
3. **Compare.** `score.mjs` pairs two runs on (conversation, repeat) and bootstraps a 95% interval over the paired deltas, using a fixed seed. It prints the deltas for all pairs, for the synthetic subset and for the real subset. It refuses to compare runs whose corpus or judge differ.

**Gate (`--gate`).** It fails when the lower bound on usefulness is below −0.5, or when the lower bound on hallucinations is above 0, meaning there are provably more of them. Run it, together with `benchmarks/minutes-injection`, before shipping any change to `packages/ai-providers/src/providers/minutes-prompt-builder.ts`.

## Corpus, and what is committed

- **Real:** the 6 Vietnamese conversations in `benchmarks/homophone-repair/data/conversations.json`. They are noisy machine turns plus an accurate `reference`. That directory is gitignored because the turns are production transcripts. On a machine without it, the run says `real corpus missing; synthetic only` and continues.
- **Synthetic:** 3 fictional meetings with 3–4 named speakers each (`synthetic-corpus.mjs`). Every real conversation has two people, so these are what measure attribution in a room of several. Nobody in them is real, which is why they can be committed. Their reference is the transcript itself.

Each run writes `rows.jsonl` and `summary.json`:

- `rows.jsonl` holds the minutes and the judge's notes, which quote production transcripts, so it is gitignored.
- `summary.json` holds only numbers: per-row scores, means, the hosts' models, a hash of the prompt, a hash of the rubric, and the real corpus's sha256. That is enough to rerun the bootstrap against any later run. It is committed.

## Cost and honesty

One run of both arms at `--repeats 2` costs (6 real + 3 synthetic) × 2 × 2 = 36 generations plus 36 judge calls.

n is small (6 real, 3 synthetic), so this is a regression tripwire, not a model ranking. The 2026-10-29 comparison of `google/gemini-3.7-flash` against `gemini-3.5-flash` gave a usefulness interval of [−0.17, +0.83], which straddles zero.
