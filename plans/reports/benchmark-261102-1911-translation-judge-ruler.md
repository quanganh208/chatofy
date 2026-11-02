# Translation judge ruler: where prod translation errors come from

**About one turn in five (22.2%) shows the reader a seriously wrong translation. Hearing and translating share the blame almost evenly (53.5% vs 46.5% of serious findings), and they do not share it across directions.** en→vi is nearly clean on translation: 1.3% of turns have a serious translation error, and its serious errors are mishearings. vi→en is where the translator fails: 23.7% of its turns have a serious translation error. Terminology accounts for none of the serious errors and segmentation for none, so domain packs and committer work are not supported.

The judge, `claude-opus-5-5`, passed its calibration gate before its table was read.

## Verdict

The plan's rule fires on its first branch: `asr` is at least 50% of findings, so **STT first**. That reading is weak, though. The interval of the `asr` share is [38.1%, 66.0%], and the `mt` share (46.5%, interval [34.0%, 61.9%]) also meets the review-loop branch (≥ 40% with a lower bound above 20%).

Read by direction instead, the table supports two levers with different owners:

1. **vi→en translation.** This is a polish-lane review loop, scoped to vi→en.
   - 23.7% of vi→en turns carry a serious `mt` error, and `mt` is 58.1% of that direction's serious findings (interval [50.0%, 66.7%]).
   - The errors are semantic, not terminological. "Ai" (AI) was read as "whoever"; a shopping item became the invented statement "There's no such thing as a shopping fee"; self-talk became a question to someone else.
   - These are what a stronger second pass can fix. It is the next plan.
2. **Hearing,** in both directions: 14.2% of all turns.
   - Among the 23 turns with a serious `asr` error, 5 are language-ID errors: Vietnamese speech decoded as English ("Em đọc cái cuốn này" → "M doctor could naive."). All five are in the two-way vi/en conversation 25320f62, matching the recorded short-vi LID weakness (memory: one-way vs two-way is the reader's choice).
   - The other 18 are mishearings that the existing STT work already targets.

Not supported: domain packs (terminology 0% of `mt`, consistent with the digest NO-GO) and committer work (segmentation 0%).

## Results (17 conversations, 162 turns, 3 repeats, majority consensus)

| statistic                            | all                | en→vi (80) | vi→en (76)         |
| ------------------------------------ | ------------------ | ---------- | ------------------ |
| turns with a serious error           | 22.2% [10.9, 36.2] | 10.0%      | 31.6% [21.5, 46.2] |
| turns with a serious `asr` error     | 14.2% [6.0, 24.3]  | 8.8%       | 17.1%              |
| turns with a serious `mt` error      | 12.3% [6.0, 23.7]  | 1.3%       | 23.7% [13.8, 40.5] |
| share of serious findings: `asr`     | 53.5% [38.1, 66.0] | 87.5%      | 41.9%              |
| share of serious findings: `mt`      | 46.5% [34.0, 61.9] | 12.5%      | 58.1% [50.0, 66.7] |
| turns with any error, minor included | 51.9%              | 28.7%      | 75.0%              |

- Intervals are 95% bootstrap, resampling conversations (10,000 draws).
- vi→zh has 6 turns and is left out of the reading.
- Short turns (≤ 4 words, 25): every serious error there is `asr`.
- Agreement: 99.4% of turns get the same majority label in 2 of 3 repeats.

## Calibration (gate passed)

| bound                                     | value | gate  |
| ----------------------------------------- | ----- | ----- |
| recall, broken copy blamed on `mt` (n=30) | 93.3% | ≥ 80% |
| clean flags (n=40)                        | 2.5%  | ≤ 10% |
| agreement (n=70)                          | 100%  | ≥ 80% |

- **Recall by rule:** negation 10/10, name 9/9 detected (8 counted as serious), omission 9/10 serious, number 1/1. No broken copy was blamed on hearing.
- **The two misses** were found but graded minor, which is defensible. "Hùng khắc" still reads as a garbled "khoảnh khắc", and the dropped clause was itself a fragment.
- **The one clean flag is a real error:** "That's four steps when it should just be two. Understand and respond." was translated without "Understand and respond". The false-alarm rate is therefore 0 of 40.
- **Thin rule:** only 1 number control could be made, because few candidates carry a digit.

## Spot check

I read 15 turns with serious errors, sampled by hash, against Scribe and the app's hearing. All 15 origins are plausible. The closest call is 74410b70: "Ai" vs "AI" is partly the recognizer's casing, which the judge charged to `mt`. It is a fair charge, because the context makes AI unambiguous.

## Setup

- **Corpus:** all 18 recorded conversations of the owner's account: 191 turns, 162 with a stored translation. Conversation 2ee8e184 stored none, and 2 more turns elsewhere also have no translation.
- **Content:** mostly podcasts and news played into the microphone, plus the maintainer's own speech.
- **Reference hearing:** ElevenLabs Scribe v2, one call per recording (18), cut into turns by `offsetMs`. Median word error app-vs-Scribe is 4%; 2 turns have no Scribe words.
- **Judge:** `claude-opus-5-5`, effort `high`, structured output, no server-side fallback, 3 repeats.
- **Spend:** $8.63 of the $100 cap: calibration $2.24, full run $6.36, smoke $0.03. There were 696 Claude calls, none failed.
- **Earlier attempt:** a Gemini attempt (`gemini-3.6-flash`) stopped at the free tier's 20 requests a day per model per project. Its partial answers are not used.
- **Code:** `benchmarks/translation-judge/` (README has the commands).

## Limits

- **One judge, one family.** Calibration bounds its errors on known breaks, but its severity on subtle meaning is still its opinion. An independent witness agrees with it: CometKiwi (`Unbabel/wmt22-cometkiwi-da`, no reference, source = Scribe's hearing) correlates with the judge's per-turn severity at Spearman −0.591 over 162 turns. Mean Kiwi is 0.753 overall and 0.806 on turns the judge found clean.
- **Small and narrow corpus.** It is 17 conversations from one account, and podcasts and news dominate. The intervals are wide, especially per direction.
- **What was judged is what was stored.** A stored translation may already be the polisher's edit, and the corpus does not record which. The polisher runs on Command Code, which was at its weekly limit on 2026-11-02, so recent turns are likely unpolished.
- **Slicing.** A spot check found 1 of 10 turns taking a clause from its neighbour. The judge is told to ignore edge words.

## Unresolved questions

- Was each stored translation polished or not? The answer changes whether a vi→en review loop is new work or a fix to the existing polisher's reach.
