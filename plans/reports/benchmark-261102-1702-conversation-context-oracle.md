# Conversation context oracle: NO-GO

Does a perfect conversation state help `deepseek-flash` translate later turns? No. The digest (phases 06–07) is not built.

NO-GO

- term gain CI: 0.033 [0.000, 0.089] (n=30)
- gain in 16+ vs 1-5: 0.032 vs 0.111
- anchoring flips, arm vs baseline: 8/33 vs 0/33

## Setup

- Corpus: 3 recorded conversations (25320f62 vi↔en, 31 turns; 2ee8e184 en podcast, 27; a68ec3c8 en, 21), plus 11 anchoring controls; 90 rows.
- Terms-only: the user chose not to write references (2026-11-02). Claude wrote 37 term checks, the controls and the domains. `mustMatch` accepts every correct rendering, not only the hinted one. chrF++ was not computed.
- Arms: `baseline` (prod hints) and `oracle` (glossary of recurring terms rendered as the corpus renders them; domain only on turns of ≤ 4 words). 3 repeats each, DeepSeek direct, thinking off.
- Calls: 540 (270 per arm). Plan running total for the paid cap: 540 of 3,000.

## Results

|                    | baseline | oracle |
| ------------------ | -------- | ------ |
| term accuracy, all | 0.973    | 1.000  |
| 1–5                | 0.889    | 1.000  |
| 6–15               | 1.000    | 1.000  |
| 16+                | 0.968    | 1.000  |
| anchoring flips    | 0/33     | 8/33   |

- Baseline misses (3 of 111): "Answer Builder" rendered as "Trình tạo câu trả lời" twice, "rest" as "khoảng lặng" once. There is no headroom to win. Prod drafts already matched 20 of 21 checkable terms.
- Oracle flips: "Chuyện tình cảm…" → "love story" 3/3; "Công ty anh tiến hành…" → "Tien's company" 2/3; "stone portal" → "cổng thông tin" 3/3. The glossary rule (offer a term when it recurs) cannot tell "chuyện tình" from "chuyện tình cảm", or "anh Tiến" from "anh tiến hành", so word boundaries would not fix it.

## Why it failed

The model already keeps names and repeated terms consistent from the turn text and the 4-utterance context. A glossary adds little where the model is right and pulls wrong senses where a term recurs with another meaning. The harm is larger than the gain.

## Limits

- Small corpus: 30 term turns. A larger one could narrow the CI, but it cannot remove the 8 flips.
- Terms and controls were written by Claude, not the user. The controls were designed to tempt the glossary, so 8/33 is a stress rate, not a prod rate.

## Unresolved questions

- None blocking. The digest could be revisited only with a sense-aware term match (e.g. the model confirming each glossary hit), which is a new design and outside this plan.
