# Call budget: replay arms against the baseline (2026-11-02)

**With the knobs, K6 and a live-preview scale of 3, a turn costs 5.67 calls (54.3% of baseline) and 4,081 billed tokens (58.9%). Every final translation got the same input as the baseline, and p50 stayed within 5%.** All three gates pass. That leaves 0.59 calls a turn of headroom for the digest.

The scale-2 arm (cut+K6) had missed the calls gate by 0.16 calls a turn. The user chose option 1 of the fork below, scale 3, and the three runs of that arm are the result.

## Arms

All arms ran on prod, on DeepSeek direct like the baseline. The Command Code window was spent, so polish was absent in every arm.

- **cut**: `TRANSLATE_SPECULATION_OVERLAP=off`, `TRANSLATE_SPECULATION_HOMOPHONES=off`, `TRANSLATE_LIVE_COMMIT_SCALE=2`.
  - Set in `prod.env`; the previous file is kept at `~/.config/chatofy/prod.env.bak-261102-cost-knobs`.
  - `chatofy_prod_api` was recreated, and the log confirmed `cost policy: speculationOverlap=off speculationHomophones=off liveCommitScale=2`.
  - 3 runs, client code from `main` without K6.
- **cut+K6**: the same env, with the client checked out at `main` plus PR #281, so no guess is made at the cut arm. 1 run.
- **cut+K6+s3**: `TRANSLATE_LIVE_COMMIT_SCALE=3`, the rest as cut+K6, run with client code from `main` at `0adcd6b3`, which includes K6.
  - The scale-2 file is kept at `~/.config/chatofy/prod.env.bak-261102-scale2`.
  - The log confirmed `cost policy: speculationOverlap=off speculationHomophones=off liveCommitScale=3`.
  - 3 runs. No DeepSeek call failed. The Command Code circuit made 3 half-open probes, all refused, among them one polish attempt.

Every run showed `turns = starts = rows = 81` and `unended = 0`.

## Results

|                    | baseline (mean of 3) | cut (mean of 3) | cut+K6 (1 run) | **cut+K6+s3 (mean of 3)**               | gate          |
| ------------------ | -------------------- | --------------- | -------------- | --------------------------------------- | ------------- |
| calls/turn         | 10.43                | 7.18 (68.9%)    | 6.42 (61.6%)   | **5.67 (54.3%)**, runs 5.63–5.70        | ≤ 6.26 (60%)  |
| billed tokens/turn | 6,927                | 5,164 (74.5%)   | 4,567 (65.9%)  | **4,081 (58.9%)**, runs 4,036–4,113     | ≤ 4,849 (70%) |
| translated p50     | 1,250 ms             | 1,247 ms        | 1,271 ms       | **1,307 ms (104.6%)**, runs 1,284–1,339 | ≤ 1,312 ms    |
| live previews/turn | 3.25                 | 2.10            | 2.15           | **1.46**                                | not gated     |

### Calls per turn by kind

| kind/purpose          | baseline | cut  | cut+K6 | cut+K6+s3 |
| --------------------- | -------- | ---- | ------ | --------- |
| translate/live        | 3.25     | 2.10 | 2.15   | 1.46      |
| translate/speculation | 2.20     | 1.88 | 1.36   | 1.33      |
| homophones            | 2.53     | 0.71 | 0.73   | 0.72      |
| fusion                | 1.18     | 1.11 | 0.79   | 0.78      |
| translate/final       | 0.64     | 0.77 | 0.75   | 0.75      |
| translate/block       | 0.57     | 0.56 | 0.57   | 0.57      |
| respell               | 0.06     | 0.06 | 0.07   | 0.05      |

The scale moves only the live lane, from 2.15 to 1.46 calls a turn. The other lanes match cut+K6 within run noise.

## Quality

- **Answer prompts.** `benchmarks/call-budget/compare-answer-prompts.mjs` checks how many final translations sent a prompt the baseline also sent, as a final or as a guess.
  - The baseline's own noise floor, each run against the other two, is 96.2–100%.
  - cut: 100% in runs 1 and 3, 89.8% in run 2.
  - cut+K6: 100%.
  - cut+K6+s3: 100% in all three runs (61/61, 59/59, 61/61).
  - All 6 unmatched prompts of cut run 2 fall between 06:54:10 and 06:54:34. That is right after the Command Code circuit reopened at 06:53:45–06:54:08, when fusion and translate attempts failed and fell back to DeepSeek. A failed fusion leaves the transcript uncorrected, so the final is built from different text. This is a host artifact, not an effect of the knobs.
  - Block prompts matched 100% in every arm.
  - The final translations therefore receive the same inputs as before. The knobs change when guesses are made and how often the live preview is redone, not what the listener is finally given. The user chose this check in place of a paid chrF++ run.
- **Corrections lost.**
  - Homophone corrections accepted: about 10 per run in the baseline, 5 with homophones off on guesses. That is about 6 fewer per 100 turns.
  - cut+K6+s3 accepted 4–5 homophone corrections per run.
  - Fusion accepted: about 58 in the baseline, about 51 in cut, 38 in cut+K6, 39–40 in cut+K6+s3. These counts include corrections on guesses that were then thrown away, so they overstate what reached the screen. The drop mostly reflects fewer guesses being made.
- **Speculation hit rate.**
  - Hits went from 34 of 81 turns to 25–27, in cut+K6+s3 too. With overlap off, 5–6 turns a run that the speaker ended now miss and take a final instead.
  - p50 did not move.
  - p95 rose in cut run 2 (2,288 ms), during the same circuit burst.

## Gate verdict (Task 4.3)

Arm **cut+K6+s3**, mean of 3 runs against the baseline mean of 3:

- **AC-C1 (calls): PASS** at 5.67, 54.3%.
- **AC-C2 (tokens): PASS** at 4,081, 58.9%.
- **AC-L (latency): PASS** at 1,307 ms, 104.6%.
  - The margin is thin: 5 ms. Run 3 alone was at 1,339 ms.
  - The baseline's own runs spread 1,208–1,296 ms, so the 57 ms shift is inside run-to-run noise, but it is not zero.
  - Likely contributors: about 8 fewer speculation hits per run, since those turns wait for a final, and DeepSeek load at the time of the run.
- **Digest headroom:** 0.60 × 10.43 − 5.67 = **0.59 calls a turn**, against an expected digest of about 0.2.

The cut+K6 arm had failed AC-C1 at 61.6%. The plan's remedy, switching a knob off, can only add calls, so it was not applied. The scale was raised instead, at the user's choice.

## Values kept

| Key                                | Value |
| ---------------------------------- | ----- |
| `TRANSLATE_SPECULATION_OVERLAP`    | `off` |
| `TRANSLATE_SPECULATION_HOMOPHONES` | `off` |
| `TRANSLATE_LIVE_COMMIT_SCALE`      | `3`   |

K6 is in the client (PR #281, merged).

The trade-offs accepted with these values:

- A Vietnamese 8 s turn gets about 1–2 live preview updates instead of 3.
- About 6 fewer homophone corrections per 100 turns.
- About 8 more turns per 81 wait for a final instead of using a guess.

## The fork that was put to the user (resolved: option 1)

1. **`TRANSLATE_LIVE_COMMIT_SCALE=3`.** Kongming projected about 5.8–6.2 calls/turn. Measured: 5.67.
2. Keep scale 2 and amend the bar. Not taken.

## Measurement notes

- The token gate counts `in + out` with cache hits at full weight. Cached tokens were 75–80% of input on every translate lane, so the gate overstates DeepSeek's actual bill by about 3–4×. This is recorded here, not acted on.
- Spend on DeepSeek direct, kept separate from the 3,000-call benchmark cap at the user's decision:
  - baseline: 2,534 calls;
  - cut: 1,745 calls;
  - cut+K6: 520 calls;
  - cut+K6+s3: 1,377 calls.

## Next

- `prod.env` holds the three kept values. Task 4.4 moves them into the schema defaults and removes them from `prod.env`.
- **Rollback:**
  - To return to scale 2, restore `~/.config/chatofy/prod.env.bak-261102-scale2`.
  - To return to the behaviour before the knobs, restore `prod.env.bak-261102-cost-knobs`.
  - Then recreate `api` with `docker compose -f docker-compose.prod.yml --env-file ~/.config/chatofy/prod.env up -d --no-deps --no-build api`, run from the deploy checkout.

## Unresolved questions

- The per-direction split of the live-lane drop (Task 4.2 step 3) is not available. The replay rows carry no language, and the `llm` log line carries no direction. The two-way replay is mostly Vietnamese speech.
- The K2 hit-rate split by continuation versus standalone turns was not computed.
