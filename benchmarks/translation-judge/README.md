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

## Decision models (Jev, Gemini Decision 1): removed

On 2026-11-14/15 two typed-decision models were measured as a polish gate (D1), an omission check (D2) and an audio LID arbiter (D3). D1 passed only narrowly with context, D2 was made unnecessary by the polish itself (below), and D3 failed. Neither model is used, and their scripts were removed on 2026-11-16. The numbers are in `docs/development-journey.md`, "Decision models (Jev, Gemini Decision 1)"; the code is in commit `d8240424`.

## Omission after polish

Is the omission check (D2, above) needed at all? Its 30 positives were never sent through the prod polisher, so a dropped sentence might not survive the second pass that already runs. If it does survive, the next question is whether a local check, with no network, catches it as well as Jev or Gemini.

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

## Polish length guard

The omission run showed the polish restoring a dropped sentence and its length guard (`2 × draft + 40` characters) discarding the restore, because a draft missing a sentence is short. The rule under test, in `guard-bound.mjs`:

- **en or vi target:** reject when the answer is longer than `2 × max(draft, source) + 40`.
- **zh target:** today's `2 × draft + 40`, unchanged. A Chinese translation is much shorter than its source, so a source bound would let long answers through.

The answer is measured as the guard measures it: transcript and draft tags removed, trimmed.

**New bars, fixed on 2026-11-15 before any run.** S0, the spend under `results/` before the sitting, is $42.81, so every judge run caps at `--budget-usd 45.81`.

- **Criterion 1, restores (offline):** of the 10 guard-rejected answers in `data/omission/a1-polished.jsonl`, the new rule accepts at least 9.
- **Criterion 2, runaways (offline, synthetic):** two sets of 20, one built on `data/calibration-clean.jsonl` and one on the 30 short-draft positives. The new rule rejects at least 19 of each; the old rule is reported beside it. Rows are taken in `id` order:
  - **context:** the first 10 rows with at least 2 context turns. The answer is the translations of the last 3 context turns (the polish prompt's window) followed by the faithful answer (the clean translation, or the positive's full translation).
  - **commentary:** the next 10 rows. The answer is the faithful answer followed by a note that quotes the whole source. That is over `2 × source + 40` by construction, so it shows only that the new rule still catches the obvious shape. The context shape carries the claim.
  - Reported per shape, with the smallest answer/limit ratio and the ids of any runaway accepted.
  - On the clean set draft and source are about as long, so the two rules nearly coincide; the short-draft set is the real test.
- **Criterion 3, regression (Command Code):** the prod polisher replayed with `--capture-raw` over the 162 judged turns (arm 2, concurrency 1). The diff set is the rows the new rule accepts and today's rejects, after the polisher's other checks (foreign script, target script, equal to the draft), with the draft read from the input file. The Opus judge sees only the diff set, 3 repeats.
  - A row introduces an error when its majority holds a serious `origin:category` that the draft's majority (`results/full-claude-opus-5-5`) does not.
  - **Pass:** at least 3 rows and none introduces an error. **Inconclusive:** 0 to 2 rows, still judged; the short-draft runaway set carries the claim. **Stop:** any introduced error, or more than 30 rows.
- **Criterion 4, the app change:** made only when criteria 1 and 2 pass and criterion 3 passes or is inconclusive. Its spec keeps the runaway case and adds a short draft with a long source (accepted), an answer over the source bound (rejected), and a zh target (draft bound).
- **Stops:** a missed bar changes nothing in the app; the maintainer decides.
- **Caps for the sitting:** Command Code at most 170 calls, tallied in `data/guard/calls.log` across resumes; the judge at most S0 + $3.

```bash
node guard-bound.mjs --stage restores
node guard-bound.mjs --stage runaways
node guard-bound.mjs --stage regression-input        # 162 rows: en_to_vi 80, vi_to_en 76, vi_to_zh 6
set -o pipefail
node review-arms.mjs --arm 2 --host commandcode --in data/guard/regression-input.jsonl \
  --out data/guard/regression-polished.jsonl --max-calls 162 --concurrency 1 --capture-raw \
  2>&1 | tee -a data/guard/calls.log
node guard-bound.mjs --stage regression-split        # refuses an incomplete replay
node judge.mjs --in data/guard/regression-diff.jsonl --out results/guard-regression-diff \
  --model claude-opus-5-5 --effort high --repeats 3 --limit-calls <3 × diff rows> --budget-usd 45.81
node guard-bound.mjs --stage regression-verdict      # results/guard-bound.md
```

**Result of criteria 1 and 2 (2026-11-15): the tested rule misses criterion 2 and is not shipped.**

- **Restores:** the new rule accepts 10 of 10 (Wilson 72.2–100%), the old 0 of 10. The longest of the 29 raw answers is 0.665 of the new limit.
- **Runaways, clean set:** the new rule rejects 19 of 20, the old 19 of 20.
- **Runaways, short-draft set:** the new rule rejects **15 of 20** (Wilson 53.1–88.8%), under the bar of 19. The old rule rejects 18. Every miss is a context runaway: 5 of 10 pass the new rule, 2 of them also pass the old one.
- **Why:** a context runaway slips under any length bound when the earlier turns are shorter than the turn itself. Context/source is 0.66–0.89 on the 5 accepted rows and 2.30–5.42 on the rejected ones. Doubling the source gives that shape room. An independent rebuild of the shapes found the same 5 rows; the harness is not at fault.
- **The bar was out of reach for the old rule too** (18 of 20), so prod's guard already has this hole. Computed after the result (post-hoc), on 126 real en/vi turns with at least 2 context turns, an answer made of the context translations plus the draft would pass today's guard on 19.
- **The prompt sends context as source text only** and says never to translate it, so this runaway needs the model to disobey. None of the 29 raw answers from the A1 replay is one, which bounds the rate only below about 11.7%.

**Successor rule:** `max(2 × draft + 40, 1.3 × source + 40)` for en/vi, zh unchanged (`successorLimit`). It accepts everything today's guard accepts, so no polish prod keeps can be lost, and it opens a band only where the draft is under about 0.65 of the source. The slope is set by real drafts, not by the 10 restores: on 156 real en/vi turns, (draft − 40)/source is at most 1.34.

**New bars for the successor, fixed on 2026-11-15 before its runs.** The 10 restores and both sets of 20 are spent: anything computed on them for the successor is post-hoc and is reported as a description only.

- **N1, non-inferiority (carries the claim):** context runaways on the held-out rows, which are the rows with at least 2 context turns after the first 10 in `id` order (25 clean, 14 short-draft positives), built exactly as before. Bar: runaways that today's guard rejects and the successor admits, **0 on the clean rows and at most 1 on the positives**. Both rules' absolute counts are reported with Wilson intervals, with no absolute bar.
  - This is a weaker claim than the spent bar. It says "no worse than today", not "stops runaways". The reason is the hole today's guard already has (19 of 126 real turns, above).
- **N2, restores:** on fresh raw answers only. The 162-turn replay is the source. About 1 of 156 real drafts is short, so it will most likely be inconclusive.
- **N3, regression:** criterion 3 above, with the successor in place of the doubled bound. The diff set is answers today's guard rejects and the successor accepts.
- **Runaway rate, no verdict:** the same replay counts raw answers over the successor limit and over `1.3 × source + 40`, and the largest answer/source ratio. Two or more real runaways would point to a guard that tightens everywhere, which is a separate plan.
- **The app change** follows only if N1 passes and N3 passes or is inconclusive. The caps for the sitting are unchanged: Command Code at most 170 calls, the judge at most $45.81.

```bash
node guard-bound.mjs --stage heldout                 # N1, plus the post-hoc restores
```

**Result of the successor (2026-11-15).**

- **N1 passes:** the successor admits no held-out context runaway that today's guard rejects, 0 of 25 clean and 0 of 14 positives. Both rules reject 23 of 25 clean (Wilson 75.0–97.8%) and 14 of 14 positives (78.5–100%).
- **Restores, post-hoc:** the successor accepts 10 of the 10 spent restores. The longest of the 29 raws is 0.921 of its limit.
- **Replay:** 162 calls to Command Code, none failed, the slowest 7.8 s. 138 rewritten, 24 left to stand (equal to the draft or refused by the script checks), 0 empty.
- **N3 is inconclusive:** no answer was rejected by today's guard, so the diff set is empty and nothing was sent to the judge ($0).
- **N2 is inconclusive** for the same reason: no fresh restore exists in real traffic of this size.
- **Runaway rate, no verdict:** 0 of 162 raw answers run over the successor limit, and 0 over `1.3 × source + 40`. The 0/162 bounds the rate only below about 2.3% (Wilson upper). The largest answer/source ratio, 4.33, is a vi→en turn with a very short source, where the +40 constant governs. With no runaway in real traffic, nothing points to tightening the guard everywhere.

The bars allow the app change: N1 passed and N3 is inconclusive.

## Recordings and consent

**Recorded 2026-11-02.** The 18 recordings are conversations from the maintainer's own Chatofy account. Some are the maintainer speaking; others are podcasts and videos played into the microphone, so those voices belong to their publishers. The maintainer approved sending all of them to ElevenLabs Scribe, and their transcripts and translations to the LLM judge (Gemini, then Claude on the Anthropic API), for this benchmark (2026-11-02). On 2026-11-14 the maintainer also approved sending the transcripts and translations to TypeSafe (Jev) and to Gemini Decision 1 on the free tier, which trains on what it receives. Nothing under `data/` or `results/` is committed: both are gitignored.

## Tests

```bash
node --test benchmarks/translation-judge/*.test.mjs
uv run --no-project --with pytest pytest benchmarks/translation-judge/tests
```
