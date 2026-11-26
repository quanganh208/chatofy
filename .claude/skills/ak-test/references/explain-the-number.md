# Explain the number

A measured number can be real and still measure something other than the claim.
Before reporting a speedup, regression, latency or throughput gate, resource
saving, or any before/after comparison, answer the seven questions below, then
give exactly one verdict. A number that skipped this check is reported as raw
data, not as a conclusion.

Tag each answer by its evidence: `measured` (observed by a run in this session),
`inferred` (derived from evidence, not run), or `guessed` (no evidence). A
`guessed` answer cannot support `faster`, `slower` or `no measurable difference`.

## The seven questions

1. **What limits it?** Name the resource that bounds the timed work: CPU, I/O,
   network, lock, queue, prefill tokens, a cold cache, a rate limit. If you cannot
   name it, you do not yet know what the number measures.
2. **Was each side tuned the same way?** Same build mode, flags, warm-up, cache
   state, concurrency, data size, model, hardware and background load. A
   comparison that tuned only one side measures the tuning.
3. **Is it physically plausible?** Check it against the known limit: bandwidth,
   token throughput, disk speed, round-trip time, the cost of the work removed. A
   speedup larger than the work removed, or faster than the hardware allows, is a
   measurement bug until shown otherwise.
4. **Were there errors or wrong output?** Count failed, timed-out, retried and
   skipped runs, and check that output is still correct. A faster run that does
   less work, fails sooner or returns wrong results is not faster.
5. **Did it repeat?** Run each side several times and report the median, the
   observed range and the sample count, not one run or a mean alone. Judge the
   claim from an uncertainty interval on the effect itself, the difference or
   ratio between the sides, computed the way the runs were collected (per pair
   when the sides ran as pairs). Observed ranges describe spread, not
   uncertainty: overlapping per-side ranges do not show that there is no
   difference, and separate ranges do not replace an interval on the effect. For
   tail statistics such as p95, confirm the sample is large enough to resolve the
   change you claim.
6. **Does it matter end to end?** Relate the measured part to what the user or
   gate actually experiences. A 50% gain on a step that is 2% of the task is a 1%
   gain; say both.
7. **What else ran inside the timed region?** List setup, compilation, downloads,
   cache fills, logging, listing or prompt overhead, and teardown that fall
   between the start and stop marks. Either exclude them on both sides or name
   them as part of the result.

## Verdicts

| Verdict | Use when |
|---|---|
| `faster` | Every side passed questions 2 to 4, the effect interval from question 5 excludes no change in the faster direction, and the effect survives question 6. |
| `slower` | The same conditions hold in the slower direction. A regression or failed latency gate is `slower`. |
| `no measurable difference` | The effect interval includes no change and is narrow enough to rule out an effect of the claimed size. |
| `inconclusive` | Any question is unanswered or `guessed`, the sides were not comparable, errors were not accounted for, no interval on the effect exists, or the interval includes no change but is too wide to rule out an effect of the claimed size. |

For metrics other than time (memory, tokens, cost), read `faster` and `slower`
as better and worse in that metric's own direction.

`inconclusive` is never a pass. Report it with the named limiter (the question
that failed and why) and the smallest step that would settle it, such as more
runs, a matched warm-up or excluding setup from the timed region. A gate that
cannot show it is within its limit has not passed it.

## Report line

Add one line beside the number in the report:

```text
Verdict: <faster|slower|no measurable difference|inconclusive> — <metric> <value>
[effect interval <interval on the difference or ratio>, n=<runs or pairs>]
vs <baseline>; limiter: <named limiter>;
end to end: <effect on the full task or gate>.
```

## Example

A latency gate compares task time with a skill catalog listed against a no-skill
arm, with a p95 ratio limit of 1.25. One model measures 1.275 [1.067, 1.513] over
240 pairs.

- Limiter (`measured`): prefill of the listing. Cache-creation tokens per run
  roughly double with the catalog listed, and runs where no skill activated show
  the same ratio as runs where one did, so activation is not the cost.
- Repeats (`measured`): the ratio interval is an interval on the effect against
  the no-skill arm, and it spans the 1.25 limit. A leaner variant that removes
  about a quarter of the added listing tokens was reported only with its own
  ratio against the no-skill arm, 1.337 [1.076, 1.671]. That its interval
  overlaps the default's does not settle the comparison; no interval on the
  leaner-versus-default effect was computed, and each p95 interval is far wider
  than the change such a cut could plausibly make.
- Verdict: `slower` than the no-skill arm (the ratio interval excludes 1.0), and
  `inconclusive` for the leaner variant against the default (limiter: no interval
  on that effect, and 240 pairs cannot resolve it with a p95 statistic). The gate is not passed: the point estimate exceeds 1.25
  and the interval cannot show the ratio is within it. The lever to evaluate is
  the listing size, not activation.
