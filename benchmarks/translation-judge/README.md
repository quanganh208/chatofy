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

   The key comes from `ELEVENLABS_API_KEY` in the environment or the repo-root `.env`, never argv. Answers are cached in `data/scribe/`, so a recording is sent once. A turn owns the Scribe words whose midpoints fall between its start (less 300 ms) and the next turn's start. On the 2026-11-02 export, a spot check of 10 turns found 1 that took a whole clause from the next turn: words spoken in a gap between turns go to the turn before. The judge is told that edge words may belong to a neighbour. Median word error between the app's hearing and Scribe's was 4%, and the 90th percentile 39%.

4. **Install** the judge's one dependency, the Anthropic SDK: `cd benchmarks/translation-judge && npm install`.
5. **Calibrate** (below), then **judge** the corpus:

   ```bash
   cd benchmarks/translation-judge
   node judge.mjs --in data/turns.scribed.jsonl --out results/<run> --model claude-opus-5-5 --effort high \
     --repeats 3 --limit-calls <n> --budget-usd 100
   node score.mjs --run results/<run> --turns data/turns.scribed.jsonl
   ```

   - **Model:** a `claude-*` model runs on the Anthropic API, with the key from `ANTHROPIC_API_KEY` or the repo-root `.env`. Any other model runs on Gemini, with `GEMINI_API_KEY`; several comma-separated keys rotate on 429.
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
- **Record:** `docs/development-journey.md`, "A ruler for translation quality".

## Review arms: testing a second pass before it ships

An arm replays the prod polisher (`OpenAiCompatibleTranslationPolisher` and its prompt, imported from `@chatofy/ai-providers`, so build it first) over the corpus. The judge then grades only the lines the arm rewrote. A line it left alone keeps the baseline judgement, because judging identical text again would only add the judge's noise.

```bash
pnpm --filter @chatofy/ai-providers build
node review-arms.mjs --arm 2                        # 1: no context (prod before), 2: earlier turns as context
node -e "…keep rows with rewritten: true…" > data/arms/arm-2-rewritten.jsonl
node judge.mjs --in data/arms/arm-2-rewritten.jsonl --out results/arm2-<reviewer>-claude-opus-5-5 \
  --model claude-opus-5-5 --effort high --repeats 3 --limit-calls <3 × rows>
node compare.mjs --base results/full-claude-opus-5-5 --arm results/arm2-<reviewer>-claude-opus-5-5 \
  --arm-turns data/arms/arm-2-deepseek-v4-pro.jsonl
```

- **Billing:** the reviewer bills `OPENAI_COMPATIBLE_API_KEY`, which is the DeepSeek key prod translates with. The rig refuses to start under a $1.00 balance and stops at `--budget-usd` (default $0.50).
- **Prod's polisher:** `--host commandcode` replays the shipped `commandcode-polish` row (`gpt-5.6-sol`, `COMMAND_CODE_API_KEY`). That plan is a call quota shared with prod, not a balance, so the run stops at `--max-calls` (default 170, one call per turn).
- **Result (2026-11-02, reviewer `deepseek-v4-pro`):**
  - vi→en turns with a serious `mt` error: 23.7% stored, 9.2% with the polisher and no context, **1.3% with context** (−22.4 points, interval [−40.4, −11.6]);
  - en→vi: not hurt;
  - CometKiwi: 0.753 → 0.768.
- **Record:** `docs/development-journey.md`, "The polisher was running blind".
- **Fallback model (2026-11-03, arm 2, reviewer `deepseek-flash`):** vi→en serious mt 23.7% → 6.6% (15 fixed, 2 broken); en→vi the same as `deepseek-v4-pro`. The reviewer cost $0.01 for 162 turns, against about $0.15 for v4-pro. v4-pro was chosen as the polish fallback while Command Code is out; judge spend reached $21.56.
- **Prod polisher (2026-11-08, arm 2, reviewer `gpt-5.6-sol` via `--host commandcode`):** vi→en serious mt 23.7% → 1.3% (17 fixed, 0 broken), the same as `deepseek-v4-pro`; en→vi 1.3% → 0.0%; all turns 12.3% → 1.2% (19 fixed, 1 broken, the broken one in vi→zh). 134 of 162 turns rewritten, p95 4.7 s. The judge cost $4.81; spend under `results/` reached $41.03.

## Decision models (Jev, Gemini Decision 1)

Can a typed-decision model decide when a paid call is unnecessary? Neither model writes text. Each answers typed questions with probabilities: TypeSafe Jev (`jev-1.14.0`) and Gemini Decision 1 (`gemini-decision-1`).

Two questions are asked about a translated turn. The state is the direction, the source, the draft and, in the `ctx` arm, the earlier turns.

- **D1, polish gate:** `fidelity`, a choice between faithful, minor and wrong. The polish runs when P(wrong) reaches a threshold.
- **D2, omission check:** `omission`, a noul: "does `translation` convey every sentence of `source`, including the last one?". A translation is flagged when P(yes) is under 0.5.

```bash
node decision-smoke.mjs                       # 3 live calls: both Gemini keys answer, Jev answers
node decision-labels.mjs                      # data/decision/labels.jsonl: 162 turns, 20 serious-mt drafts
node perturb.mjs trailing --in data/calibration-clean.jsonl --extra data/turns.scribed.jsonl \
  --from-ids decision-trailing-drops.ids.jsonl --out data/decision/trailing-drops.jsonl
node decision-gate.mjs --model <gemini|jev> --set solo --out results/decision-<model>-solo --repeats 3 --limit-calls 400
node decision-variance.mjs --run results/decision-<model>-solo   # prints the repeat count for the other sets
node decision-gate.mjs --model <gemini|jev> --set <judged|calibration|trailing> \
  --out results/decision-<model>-<set> --repeats <R> --limit-calls <n>
node decision-score.mjs                       # results/decision-verdict.md
```

- **Keys:** `GEMINI_API_KEY`, comma-separated and rotated on refusal, and `TYPESAFE_API_KEY`. Both come from the environment or the repo-root `.env` and are never printed.
- **Call caps:** every HTTP attempt, retries included, counts toward `--limit-calls`. A run refuses before its first call when the plan is over the cap, and stops the sitting on the cap or on a host that refuses every attempt. `--resume` adds only the missing answers, and `meta.json` records the attempts and how complete the run is.
- **Trailing drops:** 20 prod translations with their last sentence (at least 4 words) removed. Only `{conv, pos, kind}` is committed, in `decision-trailing-drops.ids.jsonl`, because the text is private. The rows are rebuilt from the ids, and the rebuild is byte-identical.
- **Repeats:** they shuffle the option order through a Latin square.
  - Gemini Decision 1 was fully deterministic and order-invariant (spread 0.0000), so it ran once.
  - Jev's answers vary even in the same order (spread 0.16), so it ran 3 times.

**Bars, fixed before the runs (2026-11-14):**

- **D1, on all 162 turns:**
  - At most 1 of 20 positives missed.
  - Serious mt after gating at most 2.5% (always polishing leaves 1.2%).
  - Skip at least 50%.
  - At least 15 points more skip than "polish vi→en only" at equal recall.
  - Verdict flips across repeats at most 5%.
- **D2:**
  - At least 9 of the 10 clause omissions caught.
  - At least 90% of the trailing drops caught.
  - At most 4 of 40 clean translations flagged.
- **Positives:** a draft whose serious `mt` error is held by 2 of the judge's 3 repeats.
- **Threshold:** chosen leave-one-conversation-out, as the largest that keeps 95% of the other conversations' positives. With under 20 training positives that is their lowest, so the lowest positive overall is always missed: one miss is the method's floor.

**Result (2026-11-14):**

|                                                      | Gemini, ctx          | Gemini, no ctx | Jev, ctx           | Jev, no ctx |
| ---------------------------------------------------- | -------------------- | -------------- | ------------------ | ----------- |
| D1 positives missed (of 20)                          | 1                    | 1              | 2                  | 2           |
| D1 skip                                              | 59.3%                | 53.7%          | 65.4%              | 65.4%       |
| D1 serious mt after gating                           | 1.9%                 | 1.9%           | 2.5%               | 2.5%        |
| D1 skip edge over the direction rule                 | +16.0                | +9.9           | +24.1              | +20.4       |
| D1 flips                                             | none (deterministic) | none           | 5.6%               | 7.4%        |
| D1 AUC                                               | 0.907                | 0.875          | 0.939              | 0.939       |
| **D1 verdict**                                       | **PASS (narrow)**    | FAIL           | FAIL               | FAIL        |
| D2 clause omissions / trailing drops / clean flagged | 10/10, 20/20, 4/40   | —              | 10/10, 20/20, 1/40 | —           |
| **D2 verdict**                                       | **PASS**             | —              | **PASS**           | —           |
| Latency p50 / p95, dev desk                          | 418 / 723 ms         |                | 209 / 265 ms       |             |

- **The D1 pass is narrow.**
  - The skip edge clears 15 points by about two turns, against an in-sample threshold. Recall is 19 of 20, a Wilson interval of 0.76–0.99.
  - At the leave-one-out operating point, the gate skips 6.2 points more than the direction rule and catches one more positive.
  - Without context it fails.
- **Inside vi→en,** where 18 of the 20 positives are, Gemini skips 38.2% and adds one serious turn: 1 of 76 becomes 2. The bars were not rescaled for this subset, so it is reported, not judged.
- **No winner between the models:** AUC Gemini − Jev is −0.032, with an interval of −0.104 to 0.016. Jev fails on misses and flips.
- **The gate also fires on serious errors of hearing,** on 13 of 16 turns whose serious error is not `mt`. A text-only gate is partly a hearing detector.
- **D2:** dropping the last sentence lowered P(covers all) on 20 of 20 pairs, by 0.72 (Gemini) and 0.77 (Jev). Neither model is asked about negation or names, and they catch those poorly (Gemini 7/10 and 2/9, Jev 1/10 and 1/9).
- **Spend:** 714 calls to Gemini (free tier, about 0.3M input tokens) and 1,542 to Jev (about 1.0M tokens, about $0.04).
- **What it permits:** a shadow run, not skipping the polish.
- **D3, audio LID (Gemini only):** not adopted. As a final-turn arbiter after Whisper it fails short vi (0.772 against 0.85) and `err_after_fallback` (0.064 against 0.05). See `benchmarks/lid/README.md`, `conv-r5-decision`.

## Omission after polish

Is the omission check (D2 above) needed at all? Its 30 positives were never sent through the prod polisher, so a dropped sentence might not survive the second pass that already runs. If it does survive, the next question is whether a local check, with no network, catches it as well as Jev or Gemini.

**Bars, fixed on 2026-11-15 before any run.** The spend before the sitting (S0) was $41.03 under `results/`, so every judge run caps at `--budget-usd 47.03`.

- **Positives:** `data/omission/positives.jsonl`, the 20 trailing drops and the 10 clause omissions. None of them appears in any replayed arm under `data/arms/`.
  - 16 are block rows (`block-rows.mjs`). The block path polishes with the same polisher and context under its own budget key, `block-polish`.
  - 8 are guard-bound: the full translation is longer than the polisher's `2 × draft + 40` length guard allows, so a faithful restore would be discarded.
- **Ruler:** a positive counts when the Opus judge holds a serious `mt` error of category `omission` or `segmentation` on its draft in 2 of 3 repeats. If fewer than 27 of the 30 are confirmed, the run stops to ask.
- **Survival:** a confirmed positive survives when the polish leaves the draft standing (a decline, a guard rejection or a failure), or when the judge still holds the omission on the rewritten line.
- **Survival stop:** if at most 2 confirmed positives survive, the check is not needed. The record states both denominators, the confirmed n and all 30, and the Wilson interval; 2/30 is 1.8–21.3%, so that run cannot exclude about 1 in 5 surviving.
- **Local check (new bar), if the stop does not fire:** the flag fires on either rule.
  - **Rule S:** split on `[.!?。！？…]+` followed by whitespace or the end. A sentence has at least 3 words, or at least 4 characters in zh. Flag when the source has at least 2 sentences and the translation has fewer.
  - **Rule L:** flag when `chars(translation) / chars(source)` is below its direction's 2.5th percentile on the clean set, fitted leaving out the row's own conversation.
  - It wins with recall at least 27/30 **and** at most 5% of the clean set flagged. On 151 rows clean on every origin after the polish, that is at most 7. This is stricter than D2's 4/40, so Jev and Gemini are measured again on the same clean set rather than carried over.
- **Model:** a decision model is chosen only if the local check fails and the model meets the same two bars. Fewer clean flags win, then lower p95 latency. If nothing passes, nothing ships.
- **Action (new bar):** a flag ships only if re-polishing the flagged positives with a "keep every sentence" instruction fixes at least 80% of them (no serious omission on 2 of 3 repeats) and breaks none. Flagged clean rows that the hinted re-polish breaks are counted too.
- **Caps for the whole sitting:** Command Code (the prod polisher, `gpt-5.6-sol`, a quota shared with prod) at most 60 calls, one at a time; Jev at most 480 calls.

```bash
node review-arms.mjs --arm 2 --host commandcode --in data/omission/positives.jsonl \
  --out data/omission/a1-polished.jsonl --max-calls 30 --concurrency 1 --capture-raw
node omission-verdict.mjs --stage survival      # results/omission-survival.md
```

`--capture-raw` wraps `fetch` to keep each raw answer, reading a clone so the polisher sees the untouched response. That is how a guard rejection is told apart from a decline. It needs `--concurrency 1`.

**Result (2026-11-15): the polish restores the dropped sentence, and its length guard throws the fix away.**

- **Ruler:** the judge confirmed 27 of the 30 positives, 18 of 20 trailing drops and 9 of 10 omissions (the omissions' draft judgements are reused from `results/cal-broken-claude-opus-5-5`). That is exactly the bar; the other 2 trailing drops were judged minor.
- **Polish:** 30 calls to Command Code, none failed, the slowest at 7.4 s. 19 were rewritten, 10 answers were discarded by the guard and 1 was declined.
- **Survived:** 11 of 27 confirmed (11/30 of all), Wilson 24.5–59.3%. The stop (at most 2) did not fire, so the gate reads **continue**.
- **Survivors by outcome:** guard-rejected 10, declined 1, rewritten 0.
  - Every confirmed positive the polish was allowed to rewrite, 16 of 16, lost its omission.
  - All 8 guard-bound positives survived, against 3 of the other 19. The guard rejected 2 more than predicted: there the original fits the limit, but the model's answer ran longer.
- **Counterfactual, judged and not a pipeline result:** the 10 answers the guard discarded, judged as translations, hold the omission in 0 of 10. The guard compares the answer with the draft (`2 × draft + 40` characters), and a draft missing a sentence is short. So the restore is read as a runaway answer.
  - A bound on the longer of draft and source (`2 × max(draft, source) + 40`) would accept all 10. The longest of the 29 non-empty raw answers (the declined one is empty) is 1.68 times its source.
  - How often that rule would let a real runaway through is not measured yet.
- **What did not run:** the local check, the Jev and Gemini comparison and the flag action. Re-sending a flagged turn to the polish meets the same guard, so the action could not reach its 80% bar on these rows. The maintainer chose to fix the guard first, in its own measured change, not to build a detector in front of it.
- **Spend:** 30 of the 60 Command Code calls. The judge spent $1.78 (147 calls), bringing the total under `results/` to $42.81 of the $47.03 cap.

```bash
node judge.mjs --in data/decision/trailing-drops.jsonl --out results/omission-ruler-trailing \
  --model claude-opus-5-5 --effort high --repeats 3 --limit-calls 60 --budget-usd 47.03
node judge.mjs --in data/omission/a1-rewritten.jsonl --out results/omission-a1-rewritten \
  --model claude-opus-5-5 --effort high --repeats 3 --limit-calls 57 --budget-usd 47.03
node judge.mjs --in data/omission/a1-guard-raw.jsonl --out results/omission-a1-guard-raw \
  --model claude-opus-5-5 --effort high --repeats 3 --limit-calls 30 --budget-usd 47.03
```

`a1-rewritten.jsonl` holds the rows with `rewritten: true`. `a1-guard-raw.jsonl` holds the `guardRejected` rows, with `translation` set to the raw answer.

## Recordings and consent

**Recorded 2026-11-02.** The 18 recordings are conversations from the maintainer's own Chatofy account. Some are the maintainer speaking; others are podcasts and videos played into the microphone, so those voices belong to their publishers. The maintainer approved sending all of them to ElevenLabs Scribe, and their transcripts and translations to the LLM judge (Gemini, then Claude on the Anthropic API), for this benchmark (2026-11-02). On 2026-11-14 the maintainer also approved sending the transcripts and translations to TypeSafe (Jev) and to Gemini Decision 1 on the free tier, which trains on what it receives. Nothing under `data/` or `results/` is committed: both are gitignored.

## Tests

```bash
node --test benchmarks/translation-judge/*.test.mjs
uv run --no-project --with pytest pytest benchmarks/translation-judge/tests
```
