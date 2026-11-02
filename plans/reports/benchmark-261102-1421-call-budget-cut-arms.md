# Call budget: replay arms against the baseline (2026-11-02)

**The knobs plus K6 cut calls per turn by 38% and billed tokens by 34%, with turn latency and the final translations' inputs unchanged.** That passes the token gate. It misses the calls gate by 0.16 calls a turn and leaves no room for the digest. Phase 04 stops here, as the plan requires, and hands the user one fork.

## Arms

All arms ran on prod, on DeepSeek direct like the baseline. The Command Code window was spent, so polish was absent in every arm.

- **cut**: `TRANSLATE_SPECULATION_OVERLAP=off`, `TRANSLATE_SPECULATION_HOMOPHONES=off`, `TRANSLATE_LIVE_COMMIT_SCALE=2`.
  - Set in `prod.env`; the previous file is kept at `~/.config/chatofy/prod.env.bak-261102-cost-knobs`.
  - `chatofy_prod_api` was recreated, and the log confirmed `cost policy: speculationOverlap=off speculationHomophones=off liveCommitScale=2`.
  - 3 runs, client code from `main` without K6.
- **cut+K6**: the same env, with the client checked out at `main` plus PR #281, so no guess is made at the cut arm. 1 run.

Every run showed `turns = starts = rows = 81` and `unended = 0`.

## Results

|                    | baseline (mean of 3) | cut (mean of 3) | cut+K6 (1 run)    | gate                    |
| ------------------ | -------------------- | --------------- | ----------------- | ----------------------- |
| calls/turn         | 10.43                | 7.18 (68.9%)    | **6.42 (61.6%)**  | ≤ 6.26 (60%): **FAIL**  |
| billed tokens/turn | 6,927                | 5,164 (74.5%)   | **4,567 (65.9%)** | ≤ 4,849 (70%): **PASS** |
| translated p50     | 1,250 ms             | 1,247 ms        | 1,271 ms (101.7%) | ≤ 1,312 ms: **PASS**    |
| live previews/turn | 3.25                 | 2.10            | 2.15              | reported, not gated     |

### Calls per turn by kind

| kind/purpose          | baseline | cut  | cut+K6 |
| --------------------- | -------- | ---- | ------ |
| translate/live        | 3.25     | 2.10 | 2.15   |
| translate/speculation | 2.20     | 1.88 | 1.36   |
| homophones            | 2.53     | 0.71 | 0.73   |
| fusion                | 1.18     | 1.11 | 0.79   |
| translate/final       | 0.64     | 0.77 | 0.75   |
| translate/block       | 0.57     | 0.56 | 0.57   |
| respell               | 0.06     | 0.06 | 0.07   |

## Quality

- **Answer prompts.** `benchmarks/call-budget/compare-answer-prompts.mjs` checks how many final translations sent a prompt the baseline also sent, as a final or as a guess.
  - The baseline's own noise floor, each run against the other two, is 96.2–100%.
  - cut: 100% in runs 1 and 3, 89.8% in run 2.
  - cut+K6: 100%.
  - All 6 unmatched prompts of cut run 2 fall between 06:54:10 and 06:54:34. That is right after the Command Code circuit reopened at 06:53:45–06:54:08, when fusion and translate attempts failed and fell back to DeepSeek. A failed fusion leaves the transcript uncorrected, so the final is built from different text. This is a host artifact, not an effect of the knobs.
  - Block prompts matched 100% in every arm.
  - The final translations therefore receive the same inputs as before. The knobs change when guesses are made and how often the live preview is redone, not what the listener is finally given. The user chose this check in place of a paid chrF++ run.
- **Corrections lost.**
  - Homophone corrections accepted: about 10 per run in the baseline, 5 with homophones off on guesses. That is about 6 fewer per 100 turns.
  - Fusion accepted: about 58 in the baseline, about 51 in cut, 38 in cut+K6. These counts include corrections on guesses that were then thrown away, so they overstate what reached the screen. The drop mostly reflects fewer guesses being made.
- **Speculation hit rate.**
  - Hits went from 34 of 81 turns to 25–27. With overlap off, 5–6 turns a run that the speaker ended now miss and take a final instead.
  - p50 did not move.
  - p95 rose in cut run 2 (2,288 ms), during the same circuit burst.

## Gate verdict (Task 4.3)

- **AC-C2 (tokens): PASS** at 65.9% with cut+K6.
- **AC-L (latency): PASS.**
- **AC-C1 (calls): FAIL** at 61.6%. AC-C1 also has to include the digest, about 0.2 calls a turn, so the cut leaves no headroom for it.

The plan's remedy for a failure is to switch off the costliest knob and re-run. It was written for a quality or latency failure. Switching a knob off can only add calls, so it cannot pass this gate, and it was not applied.

## The fork for the user

1. **`TRANSLATE_LIVE_COMMIT_SCALE=3`.** Kongming projects cut+K6+scale 3 at about 5.8–6.2 calls/turn (56–59%) and about 4,200–4,400 tokens/turn, which would leave about 0.26 calls a turn for the digest.
   - The cost is fewer mid-turn previews. A Vietnamese 8 s turn gets about 1–2 instead of 2–3, and English moves less because its clause rule ignores the scale.
   - This needs 3 more runs (about 1.5k DeepSeek calls).
2. **Keep scale 2 and accept 61.6%.** This means amending the bar, which only the user can decide.

## Measurement notes

- The token gate counts `in + out` with cache hits at full weight. Cached tokens were 75–80% of input on every translate lane, so the gate overstates DeepSeek's actual bill by about 3–4×. This is recorded here, not acted on.
- Spend on DeepSeek direct, kept separate from the 3,000-call benchmark cap at the user's decision:
  - baseline: 2,534 calls;
  - cut: 1,745 calls;
  - cut+K6: 520 calls.

## Next

- PR #281 (K6) is open with green CI. The prod web client picks it up only after it merges.
- `prod.env` still holds arm cut.
- To roll back, restore the backup file and recreate `api` with `docker compose -f docker-compose.prod.yml --env-file ~/.config/chatofy/prod.env up -d --no-deps --no-build api`, run from the deploy checkout.
