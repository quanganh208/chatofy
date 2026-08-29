# Kongming critique — 260829-2039 phase decomposition

Read all 6 phase files + plan.md, re-verified code claims. The decomposition is
right in shape: re-baseline first (forced by `display_fidelity.py`'s multiset-diff
hallucination definition), build-then-gate-then-wire, wire-then-delete atomic,
injection arm in phase 4. Seven concrete faults remain.

## 1. A1 is gated nowhere before the deletion (biggest flaw)

Phase 2's success criteria list A3/A4/A7/A8 — not A1. Phase 3's list A2/A12 — not
A1. Phase 4 wires and deletes ~1,700 LOC gated on phase 3 alone. A1 is first
_recorded_ in phase 6. So an ITN that reaches hallucinations=0 by over-abstaining
(recall 0.70 vs re-baselined bar) sails through phase 4, and the miss is
discovered after the LLM path is gone. Phase 2 step 7 says "score, iterate" but no
gate asserts the bar. Fix: add "A1 >= bar on the re-baselined 22" to phase 3's
success criteria (the scorer already runs there) so phase 4's dependency means
A1+A2, not A2.

## 2. The A1 bar can collapse to vacuous

Phase 1's risk section accepts "if it drops, A1's bar drops with it". The ruler
change is asymmetric: the LLM is penalized under D1 refs for a convention it was
never asked to produce (`02/09`, `mét`), while the ITN emits the refs' convention
by construction. A collapsed bar lets a mediocre ITN pass while showing fewer
digits than users saw yesterday — and a thesis examiner sees published 0.8810,
then a lower bar adopted mid-plan. Fix: A1 = max(re-baselined LLM figure, 0.8810)
with the ruler difference disclosed in the phase 6 table (a column already
exists). Affordable: the in-sample feasibility signal was 0.9524.

## 3. Phase 4 misses dead code in `turn-metrics.recorder.ts`

The inventory lists only the ":75 comment", but `RepairMetrics` (:70-101),
`recordRepair()` (:190-203) and the `'repair'` sink kind lose their only caller —
`translation-session.service.ts:463`, deleted in step 5. Phase 4's grep gate
(`repairForDisplay|repairsInFlight|...`) does not include
`recordRepair|RepairMetrics`, so it won't catch the orphan. Add both to inventory
and grep.

## 4. Phase 3's hand-review is one-shot, but the plan predicts a loop

Phase 3's own risk section says the gate is _expected_ to fail and loop back to
phase 2 — and every loop iteration invalidates the 50-row review. Fix: after the
first review, check in the approved outputs as a snapshot
(e.g. `data/display-itn-holdout-approved.jsonl`); `itn_holdout_check.mjs` diffs
against it and only changed rows need re-review. Same artifact then becomes the
durable CI regression gate for any post-thesis ITN tweak, at zero extra review
cost.

## 5. "Mirror the old script's I/O shape" is wrong for the ITN arm

`display-repaired.jsonl` rows encode guard outcomes (`faithful`, residual,
outcome) that `score_display_repair.py`'s `shown()` applies. The ITN has no
guard. Synthesizing guard-shaped fields makes the scorer print a fake "0
withheld" statistic in a thesis artifact. Define the ITN row schema explicitly
and give the scorer a no-guard input mode in the phase 1 parameterization.
Related: `score_display_repair.py:30`'s comment points at
`repair-divergence.ts`, which phase 4 deletes — reword it to a historical
constant in phase 4.

## 6. "Phase 5 could run first" is false

`gemini-translation-provider.spec.ts` is modified in phase 4 (repair specs) and
phase 5 (DEFAULT_MODELS), and A11's grep needs phase 4's deletions. Delete the
claim; keep the order.

## 7. Close the two open questions now

Browser run: yes — one manual run in phase 6, screenshot in the record; it is the
only point Q5 stops being the largest untested surface, and it costs an hour.
New audio: not needed if the claims stay split (recall in-sample, hallucination
held-out). If an examiner pushes on recall, the cheap upgrade is text-only: ~50
written sentences with digits from public text, hand-verbalized, scored with
`display_fidelity.py` — held-out recall with no recording. Name it as the
fallback in phase 6 rather than leaving "cost: not established".

Status: DONE_WITH_CONCERNS
Summary: Decomposition and ordering are correct; the load-bearing gaps are A1
ungated before deletion (fault 1) and the collapsible bar (fault 2), plus a
missed dead-code cluster in turn-metrics.recorder.ts.
Concerns: none blocking — all seven fixes are plan-text edits, no re-decomposition needed.
