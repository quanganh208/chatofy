---
phase: 3
title: 'Phase 3: Attribution instrumentation'
status: pending
priority: P1
effort: '0.5d'
dependencies: [2]
---

# Phase 3: Attribution instrumentation

## Overview

Make tap rate and correction rate readable after a session. This is the early-warning instrument for
the plan's top risk, and it has to exist before the acoustic layer, not after.

## Requirements

**Functional**

- [ ] Per session: total turns, turns explicitly attributed, turns left on fallback
- [ ] Once Phase 5 lands: suggestions **confirmed-matching**, **corrected**, and **unreviewed**
- [ ] Readable at the end of a session without a debugger

**Non-functional**

- [ ] No network call, no storage, no analytics vendor
- [ ] Counters die with the session, like everything else here

## Architecture

**Why this is its own phase and not a line in Phase 2.** The risk it measures is the one that
quietly destroys the feature, and it compounds: taps are the _only_ source of confirmed turns, so a
low tap rate starves the implicit enrolment that Phase 5 depends on, suggestions never improve, and
the incentive to correct falls further. By the time anyone notices, the acoustic layer has been
trained on almost nothing. **A sustained tap rate below ~50% in real sessions means the design is
degenerating into the enrolment-only shape the benchmark killed.** Something has to be able to say
that out loud.

**Deliberately not a telemetry pipeline.** This repo has no analytics, and adding one to observe a
feature about who spoke would mean sending exactly the data this design has worked to keep in
memory. Counters are derived from reducer state — which already holds every turn and every
attribution — and rendered locally.

**Three buckets for suggestions, not two.** "Accepted vs corrected" is the obvious pair and it is
self-certifying: if _accepted_ means _not corrected_, the metric is satisfied by nobody looking at
the screen — which is this plan's own stated premise for why a suggestion layer is dangerous. So a
suggestion ends in one of three states:

- **confirmed-matching** — somebody tapped, and agreed with the suggestion. The only evidence that
  a suggestion was right.
- **corrected** — somebody tapped, and disagreed.
- **unreviewed** — still `suggested` when the session ended. Not a success and not a failure;
  an absence of evidence, and it must be reported as one.

Rule 2 protects the centroids from unreviewed suggestions. This bucket is what protects the
_evidence_ from them, and without it Phase 6 would be reading a number that cannot fail.

**Derived, not accumulated.** No counter increments anywhere. The reducer holds the turns and their
attributions; the numbers are a selector over that state. A counter that increments independently
can disagree with what is on screen, and then neither is trustworthy.

**Where it shows.** A quiet summary line at the end of a session, in the panel that already reports
status. It reports what happened; it does not ask for anything and it does not tell the user off for
not tapping.

## Related Code Files

- Create: `packages/realtime-client/src/state/attribution-stats.ts` — selector over reducer state
- Create: `packages/realtime-client/src/state/attribution-stats.spec.ts`
- Modify: `packages/realtime-client/src/index.ts` — export
- Modify: `apps/web/src/components/translate/cascade-panel.tsx` — render the summary when stopped
- Read (do not modify): `packages/realtime-client/src/state/turn-keyed-transcript.ts`

## Implementation Steps

1. Write the selector: total turns, confirmed, fallback, and (present but zero until Phase 5)
   confirmed-matching, corrected, unreviewed. Distinguishing the first two needs the suggestion to
   be remembered after a person taps, so keep the suggested speaker id on the attribution rather
   than overwriting it — a correction that erases what was suggested erases the measurement too.
2. Spec it against reducer states built by dispatching real actions, not by hand-assembling the
   shape — a selector tested against a fixture it will never see in production proves nothing.
3. Render the summary in the panel's stopped state.
4. Record the ~50% threshold and what falling below it means, in the code, next to the selector.
   It is the number a future reader needs and the one least likely to survive in anyone's head.

## Success Criteria

- [ ] Numbers appear after a session with no devtools open
- [ ] Numbers are derived from reducer state; nothing increments a separate counter
- [ ] All three suggestion buckets exist and read zero before Phase 5
- [ ] A corrected turn still remembers what was suggested
- [ ] Nothing leaves the browser
- [ ] `pnpm --filter @chatofy/realtime-client test` and `--filter @chatofy/web test` pass

## Risk Assessment

- **The summary reads as a scold.** "You only labelled 40% of turns" is a report card. Signal: the
  wording says what the user failed to do. Response: state the counts plainly. The audience for this
  number is whoever decides whether Phase 6 is worth enabling.
- **Local-only means nobody ever sees it.** These numbers matter across many real sessions, and
  nothing aggregates them. Signal: the Phase 6 go/no-go has no tap-rate evidence to weigh. Response:
  accept the limit and write it down here — the alternative is a telemetry pipeline carrying speaker
  data off the device, which contradicts this plan's own constraint. Whoever runs the sessions reads
  the number and records it by hand.
- **It is measured with the roster's own author driving.** A developer who built the chip taps every
  turn. Signal: a tap rate near 100% in testing and far lower in the first real session. Response:
  treat only sessions with people who did not build it as evidence.
