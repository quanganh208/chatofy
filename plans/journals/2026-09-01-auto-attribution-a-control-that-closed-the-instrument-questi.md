---
title: 'Auto-attribution: a control that closed the instrument question, and six seams'
date: 2026-09-01
summary: 'Scored the bench against a published number to close OQ11, replaced the enrolment suggester with online clustering, and fixed six review-found defects at the reducer seams.'
---

# Auto-attribution: a control that closed the instrument question, and six seams

## What happened

Two threads, and the measurement one turned out to matter more.

**The instrument question.** M11 held the plan hostage: 17.15% EER on eight
seconds of clean Vietnamese, and no way to say whether that was a real domain
gap or a broken harness. The pre-registered ratio came back **1.40x**, inside the
escalation band, so the rule said report and escalate rather than pick a branch.

What broke the deadlock was noticing why M11 could not decide: **every EER in
this repo is self-referential.** Nothing had ever been checked against a number
somebody else published. The checkpoint under test publishes 1.16% on
VoxCeleb1-O, and Oxford's official trial list is still ungated even though their
audio is not — so the harness could be scored on somebody else's audio, against
somebody else's pairs.

Three arms, because three suspects fail independently:

| arm                                | isolates               | result                   |
| ---------------------------------- | ---------------------- | ------------------------ |
| A — official pairs, full length    | embedder + EER routine | 1.35% vs published 1.16% |
| B — our `build_trials`, same audio | our pair construction  | 1.69%, +0.35pt over A    |
| A1 — official pairs at 1.0s        | the duration axis      | 15.65%, R = 11.64x       |

Apparatus sound, pairing sound, **OQ11 closed SOUND**.

**The finding nobody was looking for.** Arm A1 says a model that scores 1.35% at
full length scores **15.65% on one second of English studio audio**. Our
Vietnamese one-second cell reads 24.00%. Turn length costs +14.3 points; the
language gap costs +8.4 on top. The plan had spent its whole life treating the
corpus and the channel as the problem. They are the second problem. And
`TURN_S = 1.0` came from measuring how people actually talk to an interpreter,
so the largest lever is one the product cannot pull.

**The implementation.** The shipped speaker suggester could never start: it built
a profile only from turns somebody had confirmed, so with nothing confirmed it
suggested nothing, forever. Replaced with online clustering ported from the bench
that calibrated its thresholds, plus a `pending` origin, a settle pass, and a
parity test that drives the shipped TypeScript against the Python reference.

The parity test earned itself immediately: the port returned `0` where the
reference returns `-inf` for a turn with nothing to compare against, and zero is
a legitimate cosine.

## Decision

- **K_max stays 2.** Raising it to 3 fixes the three-person case and breaks the
  two-person one: exact-count collapses 0.9967 -> 0.2300 and 76% of two-person
  conversations split into three. A constant defect in the case that always
  happens, bought for a case that is out of scope.
- **A rendered ordinal is final.** No renumbering, ever. That killed the settle
  pass as a display mechanism and made P3's monotone invariant satisfiable.
- **A person's rejection is terminal against the machine** — forced by code
  review, which found the machine re-applying labels people had just thrown away.
- **M12/M13 not run, M14 deferred**, each with its reason written down rather
  than silently skipped.

## What the review found

Six defects, all at the joins rather than in the clustering arithmetic. The
worst: a turn whose vector never arrived ended the session with no ordinal —
the last one to three turns of _every_ session — and the test named for that
case asserted the violation as the expected behaviour, under a title claiming
the opposite. Also a roster-refusal path that wedged the session permanently, a
display grouping that merged two discovered voices under one chip, and a spec
file that did not typecheck while vitest reported it green.

## Next steps

- The feature stays behind `SPEAKER_EMBEDDING_ENABLED`, off. The bench says
  0.78 clean / 0.59 far-field against a 0.85 target; it is built to be measured
  on real audio, not because the measurements say it is ready.
- A real session is the acceptance test. It also produces the turn-switch rate
  and language mix that OQ9 needs and the bench structurally cannot give.
- If the thresholds read wrong on real audio, AS-norm (M14) is where to start:
  the clean threshold moves 0.335 -> 0.192 across 8s to 1s.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
