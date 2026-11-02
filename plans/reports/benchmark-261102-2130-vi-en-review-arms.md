# vi→en review arms: the polisher with context removes almost all translation errors

**GO on arm 2.** This is the prod polish prompt, given the earlier turns' sources as context. It cuts vi→en turns with a serious translation error from 23.7% to 1.3%, a difference of −22.4 points, 95% interval [−40.4, −11.6]. It does not hurt en→vi, CometKiwi rises, and the p95 reviewer latency is 2.5 s.

Arm 1, the same prompt without context and so what prod runs today, gets about two thirds of the way there: 23.7% → 9.2%. The context is what fixes the semantic errors the ruler found. "ai" read as "with whom" or "whomever" becomes "in AI" or "on AI" once the reviewer sees that the conversation is about AI.

## Results (162 turns; judge `claude-opus-5-5`, effort high, 3 repeats, majority consensus)

| arm                         | vi→en serious `mt`              | vi→en serious any | en→vi serious any | all turns serious `mt` | mean CometKiwi | rewritten | p95 ms | reviewer $/turn |
| --------------------------- | ------------------------------- | ----------------- | ----------------- | ---------------------- | -------------- | --------- | ------ | --------------- |
| 0 stored                    | 23.7%                           | 31.6%             | 10.0%             | 12.3%                  | 0.753          | —         | —      | —               |
| 1 polish, no context (prod) | 9.2% (−14.5 [−33.8, −3.0])      | 19.7%             | 8.8%              | 4.9%                   | 0.767          | 67.9%     | 2491   | 0.00071         |
| 2 polish + context          | **1.3% (−22.4 [−40.4, −11.6])** | **9.2%**          | 8.8%              | **0.6%**               | 0.768          | 77.2%     | 2482   | 0.00091         |

- Differences are arm minus stored, in points. Intervals are paired 95% bootstrap intervals that resample conversations (10,000 draws).
- **Arm 2 fixed and broken turns:**
  - vi→en: 18 turns fixed, 1 broken;
  - en→vi: 1 fixed, 0 broken;
  - vi→zh (6 turns): 2 fixed.
- The reviewer is `deepseek-v4-pro` with thinking off. There were 0 failures across 324 calls.
- **Gate (plan AC-2 to AC-5):** all pass for arm 2.
  - win: the interval excludes 0;
  - en→vi: −1.3 points, so no rise;
  - CometKiwi: 0.768 ≥ 0.753;
  - p95: 2.5 s, under 8 s.
- Arm 3 (critique then rewrite) was not built. Its trigger was arm 2 leaving more than half of the errors, and arm 2 left 1 of 18.

## Spot read (arm 2)

- **9 of the 18 fixed turns read**, all plausible:
  - "competing for number one with whom" → "in AI";
  - "compete with whomever" → "compete on AI";
  - an invented phone call removed;
  - a doctor's quoted speech restored to the doctor;
  - a narrated report no longer rendered as an imperative.
- **One borderline fix:** "[accepted] by the publisher" keeps its bracketed insertion, and the judge accepted it this time.
- **The one break is real:** "Do ăn ở…" (karma/conduct) was dropped by the reviewer.

## What this means

- **The stored lines were probably not polished.** Arm 1, which is prod's pass, still improves on them by 14.5 points. That fits Command Code's polish being down or unreached for those turns, so it does not support the alternative that it ran and failed. The corpus does not record which, so this stays an inference.
- **The judge hears no gain on hearing errors,** as expected. vi→en "any serious" falls exactly as much as `mt`. Mishearings remain (about 8% of vi→en turns) and belong to STT.

## Caveats

- **Wrong model.** The result is measured on `deepseek-v4-pro`, but prod polishes on `gpt-5.6-sol`. The context change is model-independent, and the plan re-runs arm 2 on `gpt-5.6-sol` after Command Code's window reopens on 2026-11-04.
- **One judge family.** CometKiwi agrees in direction, but only slightly (+0.015). It is a sentence-level score and not sensitive to which referent "ai" picks.
- **Small slice.** There are 76 vi→en turns from 17 conversations. The interval is wide but clear of 0.

## Spend

- **Judge:** $8.86 for 705 calls on the rewritten rows only. The running total is $17.49 of the $100 cap.
- **Reviewer:** about $0.26 estimated, at the highest published rate. The DeepSeek balance still showed $1.46 after the runs, so the billing appears to lag.

## Unresolved questions

- Does `gpt-5.6-sol` with context match `deepseek-v4-pro` with context? This is checked after 2026-11-04.
- Should the polish run when Command Code is spent? The user decided to keep the draft, so prod gets this gain only while Command Code serves.
