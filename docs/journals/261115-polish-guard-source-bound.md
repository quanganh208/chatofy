# The polish length guard: one rule failed, a narrower one shipped (15/11/2026)

The goal was to stop the polisher's length guard from throwing away an answer that restores a dropped sentence, without letting runaway answers through.

## The first rule failed its own bar

`2 × max(draft, source) + 40` looked obvious: a restore is about as long as the source, so bound by the source. All 10 captured restores passed. The synthetic runaways did not hold up. On the short-draft set, 5 of the 10 "context translated too" runaways got under the bound. The bound for those turns doubles a long source, and when the earlier turns are shorter than the current one, their translation fits inside that slack.

The bars said "do not change the rule after seeing results", so the rule was recorded as failed rather than tuned on the same rows. An independent rebuild of the runaways confirmed the harness was right before anyone read the number as a finding.

## What shipped instead

`max(2 × draft + 40, 1.3 × source + 40)` keeps every answer today's guard accepts. It only opens a band when the draft is well under the source, which is exactly the omission case. The bars for this rule were new, committed before the run, and tested on held-out rows only. They make a weaker claim than "stops runaways": the rule is no worse than today. That fits the finding that today's guard is itself a coarse backstop, since post-hoc on 19 of 126 real turns it would let this runaway shape through.

## The replay mostly told us about prod

162 calls produced no runaway and no fresh restore. The regression check came out inconclusive, so the change rests on the held-out synthetic set and on the 10 restores from the omission run. If a future replay shows real runaways, the next step is a guard that tightens everywhere. That would be a separate change with its own regression check in the other direction.

## Lessons

- A bar that the baseline cannot meet (today's guard rejected 18 of 20, short of the 19 required) is worth noticing before the run, not after.
- Four of the five plans written for this had a step that fails as written, such as a relative `cd` followed by repo-relative paths, or a wrong `pnpm` filter. The one that ran as written won.
