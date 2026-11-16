# Decision models measured as gates: one narrow pass, no LID role

2026-11-15

## What was measured

- Could a model that answers typed questions with probabilities decide when a paid call is unnecessary? TypeSafe Jev (`jev-1.14.0`) and Gemini Decision 1 ran offline against bars fixed before the runs. The commit "feat(benchmarks): measure Jev and Gemini Decision 1 as decision gates" added `benchmarks/translation-judge/decision-*.mjs` and `benchmarks/lid/arms/gemini_decision/` with the `conv-r5-decision` results.
- **D1, polish gate**: skip the polish when the draft is already faithful, on the 162 judged turns.
- **D2, omission check**: flag a dropped clause or a dropped trailing sentence.
- **D3, audio LID**: Gemini as an LID arm and as a final-turn arbiter after Whisper.

## Outcome

- D1: Gemini with earlier turns as context passes narrowly. 1 of 20 serious-mt drafts missed, 59.3% of polishes skipped, skip-edge +16.0 against a bar of 15. Without context it fails, and Jev fails on misses and flips. This permits a shadow run only. The polish is not skipped.
- D2: both models pass. 10/10 omissions, 20/20 trailing drops, 4/40 (Gemini) and 1/40 (Jev) false flags.
- D3: not adopted. Inline replacement was ruled out before measuring, at about 1.1 s against the 150 ms gate. As an arbiter it fails both bars it existed to fix: short vi 0.772, `err_after_fallback` 0.064.

## The honest part

Gemini's D1 margin is about two turns. "Pass" is technically true and practically thin, and recall's Wilson interval reaches down to 0.76. It is a shadow candidate, nothing more. The D3 result hurts more: Gemini hears short Vietnamese far better than Whisper (0.960 vs 0.745), and the routing still could not use it.

## Lessons

- **Gemini Decision 1 is deterministic and ignores option order. Jev is not.** Jev's answers on repeated runs spread by 0.16, and 5.6–7.4% of its decisions flipped. A stochastic gate needs repeats and averaging before its numbers mean anything. Measure the variance first.
- **With a leave-one-conversation-out threshold, one miss is the floor.** With 20 positives, D1 could never report zero misses. Set the bars knowing what the protocol can actually reach.
- **A seeded shuffle gave repeats 2 and 3 the same option order.** The "order-invariance" repeats tested two orders, not three. Replaced with a Latin square, which puts each option in each position once. Check that a randomization actually varies before trusting a test built on it.
- **The first provider loop retried 429/503 refusals with no back-off,** so one row could burn its whole budget, and it accepted hollow 200s and did not retry transport errors. Fixed with one shared `ask()` in `decision-providers.mjs`: a per-question attempt budget, key rotation, back-off once every key refuses, answer validation. Covered by `decision-providers.test.mjs`. Any loop against a rate-limited API needs one budget and a back-off.
- **Whisper's confidence is a poor router.** At prod's 0.6 uncertainty threshold, only 101 of 7,946 turns reach the arbiter, and 34 of 38 short-vi errors are confident ones (≥ 0.6). An arbiter only helps on errors the router can see. Check how wrong the router is when it is confident before building a second opinion behind it.
- **commitlint rejects body lines over 100 characters.** Wrap commit bodies before committing, not after the hook fails.

## Next steps

- Owner: decide whether to wire the D1 Gemini-with-context gate as a shadow run, logging decisions with no effect on the polish, and re-check misses on live vi→en traffic before any skip goes live.
- D2 is a candidate omission flag. It needs a prod-traffic false-positive rate before it can flag anything to users.
- LID stays Whisper-only. Do not reopen D3 unless a router other than Whisper confidence exists. The 0.9 threshold result was chosen on the scored set and is report-only.
- Latency was measured from the dev desk, not the prod host. Re-measure there before any live wiring.
