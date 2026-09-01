---
phase: 3
title: 'Attribution authority state machine'
status: pending
priority: P1
effort: '1d (was 3d — validation V1 removed the re-score engine)'
dependencies: [2]
---

# Phase 3: Attribution authority state machine

## AMENDMENT — D8 pending state, 2026-09-01

**This phase predates the D8 stratum and was the one file the 2026-09-01
amendment forgot.** Phase 4 was written to say "Phase 3's authority table must
name this case explicitly, or the settle pass and the human will fight over the
same row" — and then the table was never given the case. The red team found the
gap. It is a **blocker on P4**, not a nicety: without it the pending-row race is
resolved ad hoc during implementation, which is the exact failure this phase
exists to prevent.

**A fourth state joins the authority model: `pending`.** A row whose ordinal has
not been decided yet. It is not a value the machine has chosen and withheld — it
is the absence of a decision, and D8 guarantees it is temporary.

Transitions the table must arbitrate:

| From             | Event                     | To                            | Rule                                                                                                                                                                   |
| ---------------- | ------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pending`        | settle pass assigns       | machine-assigned              | Allowed. This is the normal path                                                                                                                                       |
| `pending`        | session ends first        | machine-assigned (forced)     | Allowed, and **required** — no row may end a cleanly stopped session pending (D8)                                                                                      |
| `pending`        | **human touches the row** | **human-confirmed, terminal** | **The rule D2 already implies and P4 depends on.** The back-fill may never renumber it afterwards. The human's act decides the row even though the machine had not yet |
| machine-assigned | settle pass disagrees     | machine-assigned              | Allowed only under the monotone merge invariant below — and see the conflict                                                                                           |
| human-confirmed  | anything                  | human-confirmed               | Terminal. Unchanged (D2)                                                                                                                                               |

**Two conflicts this amendment does not resolve, and must not pretend to:**

1. **The monotone merge invariant vs. the settle pass.** This phase requires that
   a single turn may not move from `Người nói 2` to `Người nói 1` while other
   `Người nói 2` turns remain. `settle()` is a from-scratch clustering that
   renumbers by first appearance (`settle.py:52-68`) — moving a single turn is
   its _normal_ output when it disagrees with the greedy pass. **The two are
   currently unsatisfiable together.** Either the settled labels are constrained
   to a merge-only projection of the live labels (and P7-M13 measures _that_, not
   raw settle), or this invariant is withdrawn and the user-visible behaviour of
   a moving row is specified. Recorded as open question 2 in `plan.md`.
2. **Whether a human can touch a pending row at all.** P4 asks for a
   non-interactive pending placeholder _and_ for this transition to be tested.
   `SpeakerChip` renders the entire chip as a button for every origin
   (`speaker-chip.tsx:80-96`), so making pending non-interactive removes the only
   surface this rule could fire on — and its test would then be vacuous, the same
   defect this phase's Step 0 already warns about. Recorded as open question 5.

**Encoding is undecided.** Whether `pending` is a fourth `AttributionOrigin`, a
field on the attribution, or the absence of an attribution row is open question 4. Note the "compile-time forcing function" in plan Constraint 6 catches exactly
**one** consumer (`speaker-chip.tsx:52-58`); nine other sites compare string
literals and fail open on a new union member, so a new origin is _not_
self-enforcing.

## Overview

The only phase that deliberately weakens a shipped invariant, so it is specified
as a state machine first and written as code second. **The premise reversal
promotes this phase from supporting to load-bearing:** Phase 4's settle pass
writes exclusively through the machinery specified here.

Today the reducer is **write-once for every origin**: `turn-keyed-transcript.ts`
returns early at `:410` whenever _any_ attribution exists, so a turn that got no
suggestion never gets a second look — the `server.turn.embedding` event never
fires again. Retroactive re-scoring requires relaxing that. Decision D2
authorises it **for rows the user has not touched**.

`origin !== 'confirmed'` is necessary and **not sufficient**: the state cannot
currently express "a human said nobody here said this".

### What changed with the premise reversal

Under the old premise, `confirmed` rows were the common case — the user tapped,
and the invariant protected those taps. **In a zero-manual product there are no
live confirmations at all**, so the same invariant now protects something else:
the user's _later_ corrections, made when reading history. That is a smaller set
and a more important one, because it is the only human signal in the system.

Two additions the old version did not contemplate, because nothing renumbered:

- **Ordinal renumbering.** The settle pass may merge two ordinals. That is a legal
  operation on anonymous labels in a way it never was on names.
- **The monotone merge invariant** below, which is what keeps renumbering
  distinguishable from "the app changed its mind about who you are."

## Requirements

**Functional**

- A written state-machine spec — states, tombstones, triggering events, and
  which rows each event may touch — landed **before** any lever code.
- Human-cleared turns get a distinguishable tombstone and are permanently
  ineligible for re-scoring.
- `canRemoveSpeaker` counts only `confirmed`, **and** the compensating
  attribution cleanup ships in the same reducer case.
- ~~Retroactive re-scoring re-runs `suggestSpeaker`~~ — **removed by V1.** The
  scorer does not survive; P4's attributor is the sole machine writer. The derived
  trigger, the order-independence pass and the duration-aware threshold all
  belonged to it and leave with it.
- `suggestSpeaker`, `buildCentroids` and `TAU_SUGGEST` **removed from the barrel**,
  announced as a public-contract removal.
- `suggestedSpeakerId` semantics decided explicitly — P6-S2 is undefined without
  an answer (`attribution-stats.ts:76-77` skips rows that lack it).
- The extension's behaviour stated explicitly (plan non-goal, but the state
  lands there regardless).

**Non-functional**

- No wire-contract change. No server work.
- Unit test per state transition.
- **Scope after V1:** the authority table, the human-cleared tombstone, the
  `canRemoveSpeaker` narrowing with its compensating cleanup, and the
  `attribution-stats` roster guard. Nothing else.

## Architecture

### Four defects in the current state, all verified

1. **Human rejection is erasable.** `unattributeTurn` (`speaker-roster.ts:198-217`)
   has two encodings: a turn that carried a suggestion keeps a tombstone
   (`fallback` + `suggestedSpeakerId`, `:204-213`); a turn confirmed-then-cleared
   with no prior suggestion is **deleted entirely** (`:214-216`) and becomes
   indistinguishable from never-attributed. Its docstring says "nothing
   downstream can tell them apart or needs to" — re-scoring makes that false.
   Without a fix, a naive pass re-suggests onto a turn a person explicitly
   rejected, probably the same name, on the next centroid change.

2. **`canRemoveSpeaker` counts suggestions**, and the compensating write does not
   exist. `speaker-roster.ts:132-134` matches `speakerId` with no origin check.
   But `removeSpeaker` returns `SessionSpeaker[]` (`:137-144`) and the reducer
   case writes only `state.speakers` (`turn-keyed-transcript.ts:359-365`) —
   neither can clear attributions. So "make `removeSpeaker` clear suggested rows"
   is a **signature change plus a reducer-case change**, not an edit inside one
   function. If the relaxation ships without the cleanup, an attribution can name
   a speaker absent from the roster: `buildCentroids` silently skips it
   (`speaker-centroids.ts:68`), the chip renders nothing, and
   `attribution-stats.ts:74-88` still counts the orphan — inflating Phase 6's
   gate denominator. **`canRemoveSpeaker` is also a public barrel export**
   (`index.ts:94`), so narrowing it is a public-contract change, not a bug fix.

3. **Re-scoring silently redefines the ship metric.** `attribution-stats.ts:76-88`
   scores by comparing final `speakerId` against `suggestedSpeakerId`.
   Overwriting it changes the metric from "was the first live suggestion right"
   to "did the user agree with what was on screen at confirm time", and falsifies
   the promise at `speaker-roster.ts:47-57`. **Decide, do not drift:** either keep
   a separate `firstSuggestedSpeakerId` and leave the docstring true, or accept
   the new semantics and rewrite both the docstring and Phase 6's gate.

4. **The tombstone's encoding is a public type decision** (`red-team #13`).
   `AttributionOrigin` (`speaker-roster.ts:33`) is re-exported at `index.ts:100`
   and consumed by an **exhaustive** `Record<AttributionOrigin, string>` at
   `apps/web/src/components/translate/speaker-chip.tsx:52-58`. Adding a union
   member is a compile error in `apps/web` and requires a designed chip tone.
   The existing half-tombstone is encoded in a _field_, not an origin — prefer
   `clearedBy: 'human' | null` on `TurnAttribution`, which is additive and
   breaks nothing. State the choice in step 1.

### Step 0 — which engine ships (`red-team round 2`, 4/4 reviewers)

**This phase cannot start until P4's mechanism decision is made.** All four
red-team reviewers independently found the same hole: under zero-manual there are
no `confirmed` rows, `buildCentroids` (`speaker-centroids.ts:67`) returns an empty
map forever, and `suggestSpeaker` returns `null` on every call — so a re-score
pass built on them drives a dead path. Its tests would pass **vacuously**, on
fixtures that manufacture `confirmed` rows the product never creates.

Meanwhile P4 ships `OnlineAttributor`, whose `fold()` folds every machine
assignment straight back into its own centroid (`online.py:102`, called from `_assign` at `:267-270`) — the
self-reinforcing loop the section below declares impossible, in a module
`buildCentroids`' confirmed-only rule does not govern.

Three writers would then share one `attributions` map with no arbitration: P3's
re-score, P4's live attributor, and P4's settle pass.

**RESOLVED — validation V1.** `suggestSpeaker`, `buildCentroids` and
`TAU_SUGGEST` **do not survive**. P4's `OnlineAttributor` is the sole machine
writer of attributions. Consequences, all binding:

- The three symbols become dead code and **leave the barrel**
  (`index.ts:94,100,103,108`) — a public-contract removal, announced as one.
  `speaker-centroids.spec.ts:185`, which pins `TAU_SUGGEST === 0.35`, goes with
  them.
- **This phase shrinks from ~3d to ~1d**: the authority table, the human-cleared
  tombstone, and the `attribution-stats` roster-membership guard. The derived
  re-score trigger, the order-independence pass and the duration-aware threshold
  all belonged to the scorer that is now removed.
- **The confirmed-only centroid rule goes with it.** The safety argument below
  cannot be inherited — P4's centroids absorb machine assignments by
  construction, so self-reinforcement must be re-argued there, on the measured
  decay curve, not assumed away here.
- Exactly one writer owns a row at a time, and the authority table below governs
  it. <!-- Updated: Validation Session 1 - V1 -->

Sequencing note: P3 currently hardens `canRemoveSpeaker` and debounces rename in
`speaker-roster.tsx:75-77` — both inside `SpeakerRoster`, which P4 removes from
the live flow. `canRemoveSpeaker` has exactly one live consumer
(`speaker-roster.tsx:6,114`), and `removeSpeaker` is **not** barrel-exported
(`index.ts:92-98`), so its signature change is package-internal, not the
public-contract event this phase billed it as. Take P4's roster decision first.

### The old safety argument does not transfer (settled by V1)

It used to read: `buildCentroids` (`speaker-centroids.ts:67`) admits only
`origin === 'confirmed'`, so a re-scored suggestion can never influence a later
centroid. **V1 deletes both the scorer and that filter**, so the argument has
nothing left to stand on.

P4's attributor absorbs machine assignments into its own centroids by
construction (`online.py:102`, called from `_assign` at `:267-270`). Self-reinforcement is therefore a **live risk
there**, not an impossibility here — and the measured 83% → 71% within-session
decay is what it looks like. P4 owns that argument, on P1-M3's `centroid_cap`
numbers. This phase makes no claim about it.

What survives here is narrower and still true: a human edit is terminal, and the
authority table below is what enforces it.

### Authority model to specify

| Row state                                       | May the scorer write it?                         |
| ----------------------------------------------- | ------------------------------------------------ |
| user-edited (renamed, re-attributed, confirmed) | **Never**                                        |
| human-cleared tombstone                         | **Never**                                        |
| machine-assigned ordinal                        | Yes                                              |
| provisional (uncorroborated, Phase 4)           | Yes                                              |
| absent (never attributed)                       | Yes                                              |
| system-cleared (settle pass, Phase 4)           | Yes — must be distinguishable from a human clear |

### The monotone merge invariant

Renumbering is permitted; arbitrary reassignment is not. Stated precisely:

> **An ordinal may be merged into a lower ordinal. A turn's ordinal may never be
> reassigned to a different person's cluster while other turns keep that ordinal.**

Concretely: every turn labelled `Người nói 3` may all become `Người nói 2`. A
single turn labelled `Người nói 2` may **not** become `Người nói 1` while other
`Người nói 2` turns remain.

Without this, "the settle pass improved the grouping" and "the app relabelled you
as someone else" are indistinguishable from the reader's seat. With it, every
visible change is a merge, which reads as the system becoming _more_ certain
rather than changing its mind.

### Identity and ordinal must be separated (`red-team round 2`)

An earlier draft asked for two things that cannot both hold: _"ordinals are `1..k`
with no gaps"_ **and** _"no reuse of a retired number within the session"_. Settle
to {1,2,3}, merge 3 into 2, then a fourth voice appears: "no gaps" demands ordinal
3, "no reuse" forbids it.

Worse, `nextSpeakerNumber` is not a display counter — it generates the **identity**
`speaker-${nextNumber}` (`speaker-roster.ts:99`), and its docstring gives the
reason it never reuses: _"removing an unattributed speaker would otherwise make
the next id collide with a live one — the roster would then hold two people the
reducer cannot tell apart"_ (`:82-88`). Renumbering ids would silently rebind
existing `attributions[sessionId].speakerId` rows — including rows a human edited,
which this phase declares untouchable.

**Resolve by separating the two concepts**, which is also what P4's
`ordinal: number` on `SessionSpeaker` exists for:

- `speaker-${n}` stays the id: monotone, never reused.
- The **ordinal** is a derived render-time index over surviving speakers, so
  "1..k with no gaps" is a pure function of the roster.
- "No reuse" applies to **ids only**.

### Trigger set — derived, not enumerated (`red-team #12`)

An earlier draft listed `turnAttributed`, `turnUnattributed`, `speakerRemoved`,
`speakerRenamed`, roster open/close. That list is simultaneously **incomplete
and padded**:

- **Missing `server.turn.embedding`.** `buildCentroids` reads
  `(speakers, attributions, embeddings)`, and a vector arriving for an
  already-`confirmed` turn changes that speaker's centroid — but takes the early
  return at `:410` today. This is the dominant case, not an edge one: the server
  emits `server.transcript.final` **before** `server.turn.embedding`
  (`translation-session.service.ts:336` then `:349-357`), so a turn attributed on
  arrival always has its vector land afterwards. Under auto-attribution this is
  not an edge case but **the only case**: every machine-assigned turn is
  attributed the instant its transcript lands, and its vector arrives after — so
  a trigger set without `server.turn.embedding` would fire on nothing at all.
- **`speakerRenamed` is inert and harmful.** `buildCentroids` keys on
  `speaker.id` and never reads the label, so a rename cannot change a centroid.
  And `speaker-roster.tsx:75-77` wires `onRename` to the input's `onChange`, so
  it dispatches **once per typed character**. Under the old roster-re-open rule
  that meant clearing every suggested chip once per keystroke; under Phase 4 it
  would mean re-running the settle pass nine times while somebody types a name.

**Superseded by V1.** The derived-trigger specification belonged to the re-score
pass, which no longer exists. P4's attributor is driven directly by
`server.turn.embedding` in capture order, and its settle pass by
`transcript.sessionSettled`. The two findings above keep their value as
**warnings for P4**: it must consume `server.turn.embedding` (the only
vector-bearing event), and it must not be driven by `speakerRenamed`, which fires
per keystroke and cannot change any centroid.

### The extension

`apps/extension/src/meeting-transcript.ts:38-41` holds **two**
`TurnKeyedTranscript` instances (one per direction) and applies the same reducer.
It never dispatches `transcript.speakerAdded` and never sends `embedSpeaker`.
State this phase adds lands there. Also note `initialTurnKeyedTranscript`
(`turn-keyed-transcript.ts:128-137`) is an unfrozen module-level literal whose
nested containers are shared by identity across every mount — after V1 the code
most likely to write in place is **P4's attributor and settle pass**, so the
immutability assertion belongs beside them. Keep it stated here too, since the
tombstone write is also a mutation site.

## Related Code Files

- Modify: `packages/realtime-client/src/state/speaker-roster.ts` — tombstone in
  `unattributeTurn`; `canRemoveSpeaker` origin check; `removeSpeaker` signature
  so the reducer can clear attributions; docstrings at `:136`, `:181`, `:194-196`
- Modify: `packages/realtime-client/src/state/turn-keyed-transcript.ts` — the
  guard at `:410`, `transcript.speakerRemoved` at `:359-365` returning both
  `speakers` and `attributions`, and the authority comment
- Delete: `packages/realtime-client/src/state/speaker-centroids.ts` and its spec
  (V1) — `suggestSpeaker`, `buildCentroids`, `TAU_SUGGEST` all leave with it
- Modify: `packages/realtime-client/src/state/attribution-stats.ts` — roster
  membership guard in `outcomesFor`; `firstSuggestedSpeakerId` if that option is
  taken
- Modify (only if the tombstone becomes an origin):
  `apps/web/src/components/translate/speaker-chip.tsx:52-58` and its spec
- Modify: `apps/web/src/components/translate/speaker-roster.tsx:75-77` — debounce
  or commit-on-blur for rename
- Read-only, must be reasoned about: `apps/extension/src/meeting-transcript.ts`,
  `apps/web/src/hooks/use-streaming-translate.ts` (`ConversationApi` surface at
  `:95-102`), `packages/realtime-client/src/index.ts:94,100,103,108`
- Specs: `speaker-roster.spec.ts` (`:129`, `:238` assert `canRemoveSpeaker`
  false — state which inverts), `turn-keyed-transcript.spec.ts`,
  `speaker-centroids.spec.ts:185` (pins `TAU_SUGGEST === 0.35`),
  `attribution-stats.spec.ts`

## Implementation Steps

1. Write the authority state-machine spec into this file's Architecture section
   as the source of truth: states, transitions, eligibility, and the tombstone
   **encoding decision** (field vs origin — prefer field).
2. Decide `suggestedSpeakerId` vs a new `firstSuggestedSpeakerId`, and record the
   consequence for Phase 6's gate.
3. **Remove** `TAU_SUGGEST`, `suggestSpeaker` and `buildCentroids` from the
   barrel and delete `speaker-centroids.spec.ts:185`'s pin (V1). Record the
   removal as a public-contract change in the package's release notes.
4. Add the human-cleared tombstone so both clear paths are distinguishable.
   Update the docstring that says nothing downstream needs to tell them apart.
5. Fix `canRemoveSpeaker` to count only `confirmed`. In the **same** change, make
   `transcript.speakerRemoved` return both `speakers` and `attributions`, clear
   `suggested` rows naming the removed speaker. Note the public-contract change
   in the package's release notes.
6. Add the roster-membership guard to `attribution-stats.ts` so orphans cannot
   inflate Phase 6's denominator.
7. Relax the reducer guard to the authority table and rewrite the authority
   comment. The trigger itself is P4's (`server.turn.embedding` in capture order,
   never `speakerRenamed`).
8. ~~Implement the re-score pass~~ — **removed by V1.** The equivalent work is
   P4's attributor and settle pass, both specified there as pure functions.
9. Move rename to the chip (V2) with commit-on-blur, so a keystroke is not an
   edit. `speaker-roster.tsx:75-77` leaves the live flow with the roster.
10. ~~Duration-aware threshold~~ — **removed by V1** with the scorer it belonged
    to. P4 calibrates its own thresholds per Phase 2's verdict, never on corpus
    cells.
11. State the extension's behaviour and add a spec asserting
    `initialTurnKeyedTranscript` is deep-unchanged after a reducer sequence.
12. Unit-test every transition: no write over `confirmed`; no write onto a
    tombstone; attribution cleanup after `speakerRemoved`; and that a human edit
    survives every machine write path P4 introduces.

## Success Criteria

- [ ] Step 0 **resolved by validation V1**: P4's attributor is the sole machine
      writer; `suggestSpeaker`/`buildCentroids`/`TAU_SUGGEST` are removed
- [ ] Exactly one writer owns a row at a time; the authority table governs
      whichever engine ships — asserted against the shipped writer, not a
      `confirmed`-row fixture
- [ ] State-machine spec written, including the tombstone encoding, before lever
      code exists
- [ ] **The monotone merge invariant holds** — an ordinal may merge into a lower
      one; a turn's ordinal is never reassigned to a different cluster while
      others keep it. Asserted by test
- [ ] **Identity and ordinal are separate:** `speaker-${n}` ids stay monotone and
      never reused; ordinals are a derived `1..k` render-time index. The two
      earlier criteria that contradicted each other are replaced by this one
- [ ] A turn a person cleared is never re-suggested — asserted by test
- [ ] **No path writes over a user edit** (rename, re-attribute, confirm) —
      asserted
- [ ] `canRemoveSpeaker` counts only `confirmed`, and no attribution can name a
      speaker absent from the roster — both asserted
- [ ] `outcomesFor` ignores orphaned attributions — asserted
- [ ] ~~Re-score fires on `server.turn.embedding`~~ — **removed by V1**; the
      attributor in P4 owns that path now
- [ ] Rename commits on blur, from the chip (V2) — a keystroke is never an edit
- [ ] ~~Re-score pass is order-independent~~ — **removed by V1**; order-independence
      moves to P4's capture-order requirement
- [ ] No path writes over `confirmed` — asserted
- [ ] `TAU_SUGGEST`, `suggestSpeaker` and `buildCentroids` removed from the barrel
      and the removal announced (V1); `speaker-centroids.spec.ts:185` deleted
- [ ] `suggestedSpeakerId` semantics documented and consistent with Phase 6-S2
- [ ] The extension's behaviour stated; `initialTurnKeyedTranscript` immutability
      asserted
- [ ] The tombstone and cleanup writes add no measurable per-turn cost (the
      former re-score budget moves to P4's attributor and settle pass)

## Risk Assessment

**The authority model stays implicit and defect 1 ships.** _Signal:_ the
implementation describes re-scoring as "loop over non-confirmed and re-run
`suggestSpeaker`". _Response:_ step 1 is a hard prerequisite.

**The `canRemoveSpeaker` half ships without the cleanup half.** It is one line;
the compensating change is a signature plus a reducer case. _Signal:_ an
attribution naming a removed speaker. _Response:_ step 5 is atomic, with a test
asserting the invariant directly.

**Label churn wider than D2 authorised.** _Signal:_ a confirmed chip changes.
_Response:_ asserted, not assumed.

**A public-contract change slips out unannounced.** `canRemoveSpeaker`,
`TAU_SUGGEST`, `suggestSpeaker` and `AttributionOrigin` are all barrel exports.
_Response:_ step 3 and step 5 name them explicitly.

**Docstrings become quiet lies.** Four comments describe the write-once world
(`speaker-roster.ts:136`, `:181`, `use-streaming-translate.ts:97`,
`turn-keyed-transcript.ts:360`). _Response:_ rewritten as part of the change.
