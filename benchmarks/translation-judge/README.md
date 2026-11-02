# Translation judge

Where do the errors in prod translations come from: the app mishearing, the translator, or where a turn was cut?

This benchmark answers that without human grading and without reference translations. An LLM judge annotates errors on real prod turns in MQM style: a span, a category, a severity, and an **origin** (`asr`, `mt`, `segmentation`, `unclear`). It reads each turn twice over: as the app heard it, and as an independent transcriber (ElevenLabs Scribe v2) heard the same recording. That second hearing is what lets it blame a mishearing on the recognizer rather than on the translator.

The judge is not trusted on its word. Before its table is read, it must pass a calibration gate on known answers (see "Calibration").

Measurement-only. It is **not** part of the pnpm/turbo workspace and never imported by the app, the same convention as `benchmarks/error-analysis` and `benchmarks/conversation-context`.

## Steps

1. **Build** the packages the export reuses: `pnpm --filter @chatofy/ai-providers... build`.
2. **Export** the owner's recorded conversations. This reads the prod database read-only and downloads recordings from the public R2 URL:

   ```bash
   node benchmarks/translation-judge/export-conversations.mjs --owner <userId> [--conv <clientId,…>]
   ```

   It writes `data/turns.jsonl`, `data/recordings.jsonl` and `data/audio/`. A turn is read the way `conversation-context/export-turns.mjs` reads it: what the reader saw, translated into the first other conversation language. It carries the four previous turns as context.

3. **Transcribe** each recording once with Scribe, and cut its words into turns by time:

   ```bash
   python3 -I benchmarks/translation-judge/scribe_turns.py --consent-recorded --limit-calls <n>
   ```

   The key comes from `ELEVENLABS_API_KEY` in the environment or `apps/api/.env`, never argv. Answers are cached in `data/scribe/`, so a recording is sent once. A turn owns the Scribe words whose midpoints fall between its start (less 300 ms) and the next turn's start. On the 2026-11-02 export, a spot check of 10 turns found 1 that took a whole clause from the next turn: words spoken in a gap between turns go to the turn before. The judge is told that edge words may belong to a neighbour. Median word error between the app's hearing and Scribe's was 4%, and the 90th percentile 39%.

4. **Install** the judge's one dependency, the Anthropic SDK: `cd benchmarks/translation-judge && npm install`.
5. **Calibrate** (below), then **judge** the corpus:

   ```bash
   cd benchmarks/translation-judge
   node judge.mjs --in data/turns.scribed.jsonl --out results/<run> --model claude-opus-5-5 --effort high \
     --repeats 3 --limit-calls <n> --budget-usd 100
   node score.mjs --run results/<run> --turns data/turns.scribed.jsonl
   ```

   - **Model:** a `claude-*` model runs on the Anthropic API, with the key from `ANTHROPIC_API_KEY` or `apps/api/.env`. Any other model runs on Gemini, with `GEMINI_API_KEY`; several comma-separated keys rotate on 429.
   - **Limits:** `judge.mjs` prints the planned calls and refuses above `--limit-calls` before the first request. `--out` must be new unless `--resume`, which adds only the missing (turn, repeat) answers.
   - **Budget:** `--budget-usd` caps the spend of every run under `results/` together, summed from each answer's recorded `costUsd`. No new call starts once it is reached.
   - **Refusals:** no server-side fallback is enabled, so a declined turn fails and is never answered by a different model inside a one-model run.

### Choosing the judge

The judge is `claude-opus-5-5` at effort `high`, the maintainer's choice on 2026-11-02. It is independent of the translator (DeepSeek) and the polisher (`gpt-5.6-sol`). Gemini was tried first and dropped. The free tier allows 20 requests a day per model per project, so the four prod keys gave 80 a day against the roughly 700 needed. The pro models have a quota of 0, and Command Code's plan was at its weekly limit.

A smoke run cost about $0.01 a call at effort `medium`.

## Calibration

Known answers are made by rule, not by a model (`perturb.mjs`):

```bash
node perturb.mjs candidates --in data/turns.scribed.jsonl > data/calibration-clean.jsonl
node judge.mjs --in data/calibration-clean.jsonl --out results/cal-clean-<model> --model <id> --effort high --repeats 3 --limit-calls 120
node perturb.mjs perturb --in data/calibration-clean.jsonl --judged results/cal-clean-<model> > data/calibration-perturbed.jsonl
node judge.mjs --in data/calibration-perturbed.jsonl --out results/cal-broken-<model> --model <id> --effort high --repeats 3 --limit-calls 120
node calibrate.mjs --clean results/cal-clean-<model> --perturbed results/cal-broken-<model> --set data/calibration-perturbed.jsonl
```

- **Candidates** are turns of 5–30 words, translated into vi or en, where the app and Scribe heard the same words (word error ≤ 10%).
- **Broken copies** are made only from candidates the judge found free of serious errors. There are four rules: shift a number, flip a negation, swap a name, drop the longest clause.
- **Gate:** all three must hold.
  - Recall at least 80%: a broken copy draws a serious error blamed on `mt`; one blamed on hearing is a miss.
  - Clean flags at most 10%: an upper bound on false alarms, since a candidate's translation can be really wrong; the flagged rows are listed to read.
  - Agreement at least 80%: the majority label is shared by 2 of 3 repeats.

## What the numbers mean

- **Consensus:** an error counts for a turn when 2 of its 3 repeats report the same origin, or the same origin and category. Spans are not matched, because their wording drifts between repeats. Only major and critical errors make a turn wrong; minor ones are reported separately.
- **Shares:** `score.mjs` reports the share of turns with a serious error of each origin, and the split of serious findings between origins. Each has a 95% bootstrap interval that resamples conversations (10,000 draws, fixed seed).
- **Verdict:** the plan's rule, printed first.
  - `asr` at least 50% of findings → STT first.
  - `mt` at least 40% with the interval's lower bound above 20% → a polish-lane review loop. If terminology is at least 30% of those, domain packs as well.
  - `segmentation` at least 30% → the committer.
  - Otherwise, no single lever.

## Results (2026-11-02)

- **Calibration:** `claude-opus-5-5` at effort `high` passed the gate. Recall was 93.3% (n=30), with clean flags at 2.5% (n=40); the one clean flag was a real omission. Agreement was 100%.
- **Corpus:** 162 turns from 17 conversations. 22.2% have a serious error.
  - en→vi: 1.3% of turns have a serious `mt` error, and its errors are mostly hearing.
  - vi→en: 23.7% of turns have a serious `mt` error.
  - Terminology and segmentation caused no serious errors.
- **Spend:** $8.63.
- **Report:** `plans/reports/benchmark-261102-1911-translation-judge-ruler.md`.

## Recordings and consent

**Recorded 2026-11-02.** The 18 recordings are conversations from the maintainer's own Chatofy account. Some are the maintainer speaking; others are podcasts and videos played into the microphone, so those voices belong to their publishers. The maintainer approved sending all of them to ElevenLabs Scribe, and their transcripts and translations to the LLM judge (Gemini, then Claude on the Anthropic API), for this benchmark (2026-11-02). Nothing under `data/` or `results/` is committed: both are gitignored.

## Tests

```bash
node --test benchmarks/translation-judge/*.test.mjs
uv run --no-project --with pytest pytest benchmarks/translation-judge/tests
```
