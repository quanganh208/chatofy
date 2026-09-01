---
phase: 4
title: 'Bounded-K auto-attribution and settle pass'
status: pending
priority: P1
effort: '6d (was 4d — see Mechanism)'
dependencies: [3]
---

# Phase 4: Bounded-K auto-attribution and settle pass

## SUPERSEDED — abstention is out, 2026-09-01

**The user ruled that a chip which never resolves to a person is a failure:**

> _"theo tôi là thất bại"_ — asked whether a "Người ?" chip on an undecidable
> turn was acceptable behaviour.

Every part of this phase that renders, or plans to render, a permanent no-chip /
unattributed state is **superseded**. It is struck rather than deleted, because
the reasoning that produced it is still the reasoning that constrains the
replacement.

**The display contract, replacing abstention:**

> Every turn ends the session carrying an ordinal. A turn's ordinal may change
> while it is pending. Once settled or human-touched, it never changes again.

This is **defer then back-fill**, not abstain. The difference is the terminal
state: deferral is a few seconds of a pending row; abstention is a row that stays
nameless forever. The user has already accepted late resolution as a shape —
_"sau này sẽ lưu lịch sử rồi sửa lại sau thì tuỳ user"_.

~~Note this converges with what the red team already found below: the criterion
was already established as unimplementable — `K_max` guards `_create` while the
assign branch runs first (`online.py:125` before `:128`) — **both line numbers
wrong** — so an over-cap turn is folded into the nearest ordinal at a measured
64.9% theft rate.~~ **RETRACTED
2026-09-01 — that paragraph was false** (plan correction C1). The cap **is**
consulted before the assign test: `observe` (`online.py:232`) overrides the bar
to `tau_assign_capped` at `:247-248` and tests at `:250`, and `above_cap="abstain"`
returns `label=None` at `:263`. Three policies are implemented and validated
(`:59`, `:176-183`).

**So D8 alone is why the no-chip criterion is gone — not implementability.**
And the 64.9% theft rate is separately disqualified: it is the `enrolled=2` row
of `guest-summary.csv`, measured 2026-08-26 at **2.0s**, in a seeded mode D4
removed from the product. It may not be cited as a decision input until re-run
cold at 1.0s.

**This phase is blocked at Step 0.** Every `campplus, far-field, cold` row of
`1s-m9-k2-abstain.csv` and `1s-m9-k2-raise_tau.csv` is `count_constraint=
unreachable`, `verdict=NO-CONFIG`, accuracy columns empty — 3/3 splits each. Only
`assign` produced numbers and it is `FAIL`.

**Diagnosed 2026-09-01, and the stop rule does NOT apply as written.** The
`unreachable` rows are a **harness artifact**. `calibrate` discards any grid point
below `ATTRIBUTION_FLOOR + CALIBRATION_MARGIN = 0.94` _before_ the count criterion
is evaluated — and both non-default policies withhold attribution above the cap by
design, so that floor is structurally unreachable for them. Measured on the host
(105-point grid, 150 meetings/point, campplus far-field N=2 cold, 1.0s cache):

| above_cap   | max attribution rate | accuracy at that point | grid points clearing 0.94 |
| ----------- | -------------------- | ---------------------- | ------------------------- |
| `assign`    | 0.9953               | 0.8332                 | **12 / 105**              |
| `abstain`   | **0.8747**           | **0.8483**             | **0 / 105**               |
| `raise_tau` | **0.7927**           | **0.8654**             | **0 / 105**               |

**`NO-CONFIG` says nothing about whether these policies attribute correctly.** It
says the calibrator cannot grade a policy whose purpose is to attribute less. And
the two discarded arms scored _higher_ accuracy than the one that survived.

**Under D8 the floor has also lost its original meaning.** It was written when an
unattributed turn stayed unattributed forever. With defer-then-back-fill a turn
that abstains live still ends the session with an ordinal, so live attribution
rate is a **cost** (how many turns defer, and for how long — P6's S4b) rather than
a **gate**.

**These are diagnostic numbers, not gate numbers:** calibration speakers not
held-out, max-_rate_ grid points not max-_accuracy_ points, and no transfer loss
applied (measured mean +3.5pt, p90 +10.4pt). They may not be quoted as a verdict.

**What Step 0 now needs** is a proper measurement of the two arms with the
attribution floor reported as a cost instead of applied as a filter, calibrated
on calibration speakers and evaluated on held-out ones. That requires choosing a
floor, which is a plan-level decision — see the open question below. Do **not**
default to `assign` on the strength of it being the only arm with numbers.

### Specification the replacement must satisfy

1. **Horizon — corrected 2026-09-01.** A pending row is force-assigned at the
   settle pass or at session end, whichever comes first. **But the settle pass
   may not ship** (M10 rejected it on merge; P7-M13's bar now carries a merge
   term precisely so it cannot be reinstated through a metric that cannot see
   why it was rejected). If settle does not ship, session end is the _only_
   horizon — and then every chip is a placeholder until the user presses stop,
   which is the outcome D8 exists to forbid. **State the horizon for the
   no-settle case explicitly before implementing.**

   **The trigger does not exist on the paths that matter.** `transcript.
sessionSettled` was to be dispatched "from the hook's `stop` path", but:
   `ConversationSession` stops _itself_ on socket close
   (`conversation-session.ts:341`) and failed start (`:492`), neither of which
   reaches the hook's callback; `useEffect(() => stop, [stop])` does not run on a
   hard tab close; and `stop()` closes the socket immediately (`:511`, `:532`)
   while up to `MAX_IN_FLIGHT = 3` turns are still server-side, whose vectors are
   then never emitted because the emit is guarded by `registry.holds`
   (`translation-session.service.ts:350`). **So the last 1-3 turns of every
   session have no vector at settle time.** Dispatch from `onStopped` plus a
   `pagehide` listener, and specify what ordinal a turn with **no vector at all**
   receives — open question 3 in `plan.md`. Restate the criterion as "zero rows
   end a **cleanly stopped** session pending"; the hard-tab-close case is an
   accepted unobservable outcome, not a testable guarantee.

2. **Band coverage.** The no-abstention rule covers **both** undecided states,
   not only the over-cap one: the between-thresholds abstain at `online.py:265`
   is equally forbidden as a terminal state.
3. **Authority interaction — this is the one that will bite.** A row a human
   touches while its ordinal is still pending becomes **terminal immediately**
   (D2). The back-fill may never renumber it. Phase 3's authority table must name
   this case explicitly, or the settle pass and the human will fight over the
   same row. Phase 3 is a dependency of this phase; that table is where this
   belongs. **Done 2026-09-01** — see Phase 3's "AMENDMENT — D8 pending state",
   which adds the state and the transition, and records the two conflicts it
   cannot resolve alone (open questions 2 and 5).
4. **K-cap stays.** Bounding the ordinal count is not abstention. Removing the
   cap re-admits the measured over-split catastrophe — `over_split_rate = 1.000`
   on 2 of 3 splits, signed count error **+6.37 / +6.76**, two people rendered as
   eight or nine chips.
5. **Renumbering is user-visible and needs its own contract.** Filling an empty
   chip is uncontroversial. Changing a rendered "Người 1" into "Người 2" is not,
   and no decision covers it yet — **open question 2** in `plan.md`. Settling
   on a cadence (every k turns, or at a pause > 3s) rather than every turn keeps
   the churn bounded whichever way that resolves.

**Governing metric follows the contract, not the other way round.**
`prefix_locked_accuracy` was the right gate while a rendered ordinal was
irrevocable; under this contract it is a lower bound. Phase 7's M13 pre-registers
**settled-label accuracy** as the gate and reports prefix-locked beside it.

## Overview

The delivery phase. Ships zero-manual speaker attribution with anonymous ordinal
labels, bounded by `K_max`, and settling once per session.

This phase replaces "Enrollment and roster closure". Roster closure was a
**social** guarantee purchased with a human act the user rejected. `K_max` is a
weaker but automatic substitute — and the red-team pass established exactly how
much weaker. That correction is the whole of the Mechanism section below.

## Mechanism — corrected after red team

An earlier version of this phase claimed: _"Above `K_max`, turns render no chip
rather than an invented ordinal,"_ and that the no-chip state was the existing
`fallback` tone needing "no new visual vocabulary". **Both halves were false.**
The mechanism below is what the shipped code actually permits.

### ~~`K_max` bounds creation. It cannot bound assignment.~~ FALSE — retracted 2026-09-01

**The block quoted here did not exist in the file.** Phase 1's implementation
rewrote `online.py` and no citation was re-anchored; the quote below is ~120
lines stale and its conclusion is the opposite of the truth. Kept only so the
error is legible.

~~```python
if best_score >= self.tau_assign: # :125 assign + fold
...

````~~

**What `observe` (`online.py:232`) actually does:**

```python
assign_bar = self.tau_assign
if self.cap_bound and self.above_cap == "raise_tau":   # :247-248
    assign_bar = float(self.tau_assign_capped)
if best_score >= assign_bar:                           # :250
    ...
if best_score < self.tau_new:                          # :254
    if not self.cap_bound:                             # :255
        return self._open(vector, score=best_score)
    if self.above_cap == "assign":                     # :257
        self._assign(best, vector)                     # wrong name, right count
        return Assignment(label=best, created=False, score=best_score)
    return Assignment(label=None, created=False, score=best_score)   # :263
````

**The cap is consulted before the assign test.** `ABOVE_CAP_POLICIES =
("assign", "abstain", "raise_tau")` (`:59`), validated at `:176-183`. Suppressing
assignment once the cap binds is implemented and already measured. The three
options below are therefore a **real fork**, not one forced move — but see
"blocked at Step 0" above: two of the three produced no numbers.

The measured split, campplus far-field, 2 enrolled (`results/guest-summary.csv`):

| outcome                                      | rate       |
| -------------------------------------------- | ---------- |
| **stolen** — labelled as an existing speaker | **0.6492** |
| undecided                                    | 0.2868     |
| own cluster                                  | 0.0640     |

**So `K_max` bounds the chip count, not the error.** Below the cap it makes
over-split arithmetically impossible, which is real and is why it survives.
Above the cap it converts a visible count error into an invisible
misattribution — which in a translation app is the semantic failure D6 raised
the accuracy bar to 0.85 to prevent.

**D5 is restated honestly in `plan.md`.** This phase does not claim abstention it
cannot deliver.

### The above-cap behaviour is P1-M9's decision, not this phase's

Per the user's decision of 2026-08-30, the plan does **not** pre-commit. P1-M9
runs a bounded-K arm at `K_max ∈ {2, 3}` and reports, separately:

- **misattribution rate** — turns from an unmodelled speaker assigned to an
  existing ordinal;
- **abstention rate** — turns below `tau_assign` that render nothing;
- **exact-count rate** among the modelled speakers.

Only then is the above-cap policy chosen, from three options whose costs M9
prices:

| Option                                                | Above the cap                     | Cost                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — assign anyway** (what the algorithm does today) | ~65% misattribution               | Silent wrong names in a translation app                                                                                                                                                                                                  |
| **B — suppress assignment once the cap binds**        | true silence                      | Needs to know the cap has bound. The unmatched-speaker detector is **36.5% at 5% false alarm, AUC 0.7743** (`results/session-guest-detection.csv`) — it fires late and often not at all, so this trades silent theft for mass label loss |
| **C — raise `tau_assign` above the cap**              | fewer, more confident assignments | A middle point M9 can measure directly; costs abstention on the modelled speakers too                                                                                                                                                    |

If M9 shows no option clears D6 at N=2, that is a stop signal, not a prompt to
pick the least-bad one silently.

### "No chip" must be built. `fallback` is a tap prompt.

`speaker-chip.tsx:79-98` renders `fallback` as a `Badge` wrapping a `<button>`
whose label is `t('web.translate.speakerUnknown')` — **"Ai đã nói?"** — and whose
`onClick` opens the manual picker. `conversation-transcript.tsx:155-179` renders
a `SpeakerChip` for **every** group unconditionally, defaulting `origin` to
`'fallback'`.

Reusing it for abstention would fill the screen with requests to do manual
attribution, in the one product whose stated requirement is _"không muốn user
phải manual bất cứ chỗ nào."_ A genuine no-chip path is a conditional in
`conversation-transcript.tsx` plus a `speaker-chip.spec.tsx` case — a real work
item, not a reuse.

### Machine ordinals must split a display group

`display-groups.ts:103-107` splits a merged block only when **both**
attributions are `confirmed`, on the stated reasoning that _"a suggestion is not
evidence anybody looked."_ That rule was written when `suggested` meant
"unreviewed guess". Under this phase it means "the product's answer", and nothing
is ever `confirmed`.

Left alone: a `cutForced` turn followed within `MAX_CAPTURE_GAP_MS` (1200) by a
different speaker merges into one block, and
`conversation-transcript.tsx:152-154` renders **one chip** for it. Two people,
one ordinal — and P6's S1 counts chips against heads, so the ship gate would be
measuring the grouping rule rather than the attributor.

Extend the split to any two attributions naming different speakers regardless of
origin.

### Where the attributor's state lives

`OnlineAttributor` is mutable: `fold` and `_create` mutate `_clusters` in place
(`online.py:59-70,132-134`). "Pure, no reducer coupling" and "driven by
`server.turn.embedding`" cannot both hold. The state must be a **serializable
field on `TurnKeyedTranscript`**, rebuilt per action.

A module-level or ref-held instance leaks across boundaries the repo already
guards:

- `transcript.reset` returns `initialTurnKeyedTranscript`
  (`turn-keyed-transcript.ts:306-307`) and fires on **every** `start()`
  (`conversation-session.ts:283` → `use-streaming-translate.ts:262`). Clusters
  held outside the reducer would survive it — a cross-session voiceprint, which
  the shipped contract forbids (`speaker-roster.ts:10-15`) and this plan lists as
  a non-goal.
- `apps/extension/src/meeting-transcript.ts:38-41` holds two
  `TurnKeyedTranscript` values initialised from the **same** unfrozen module
  literal; a shared cluster set would let inbound and outbound poison each other.

### The trigger, concretely

The earlier text said "on pause and at session end". Neither exists:

- **There is no pause.** `cascade-panel.tsx:21` — _"There is no stop button by
  design"_; `:102-106` renders exactly start or stop.
- **`server.session.ended` is per turn.** `TurnSession` mints a fresh `sessionId`
  per turn (`turn-session.ts:34`), so wiring settle to it re-clusters the whole
  session on every turn — O(n²) growth on the main thread, and mid-conversation
  renumbering that would show up as the very churn P6-S3 exists to detect.

Add an explicit `transcript.sessionSettled` action dispatched from the hook's
`stop` path, and state the live cadence as a bounded rate (e.g. every N turns, or
on ordinal-set change) with an **invocation-rate bound beside the ≤20ms
per-invocation budget**.

### Embedding arrival is completion order, not speaking order

`use-streaming-translate.ts:30` sets `MAX_IN_FLIGHT = 3` with `continuous: true`
(`:303-306`); each turn's embedding is emitted after that turn's own translation
resolves (`translation-session.service.ts:348-357`), and translation latency
varies by seconds. `display-groups.ts:112-116` already documents the consequence:
_"`turns` is COMPLETION order."_

`observe` is greedy and path-dependent — the first vector unconditionally creates
cluster 0. So a short second turn that completes first becomes `Người nói 1`, and
the person who actually spoke first becomes `Người nói 2`, in a transcript the
user reads in speaking order.

**Order the attributor by capture time**, which the reducer already holds
(`captures[sessionId].openedAt`, `turn-keyed-transcript.ts:118-127`).

### The ordinal is a number in state, not a string

There is no ordinal in the state today. `SessionSpeaker` is `{ id, label }`
(`speaker-roster.ts:36-39`), and the ordinal exists only inside an already
localized, already interpolated `label` built in `apps/web`
(`use-streaming-translate.ts:344`). The reducer's own fallback is the hardcoded
English `` `Speaker ${nextNumber}` `` (`speaker-roster.ts:99`), and the comment
above it says why the package must not format: it ships to the extension and
holds no dictionary.

Minting in the reducer while removing the roster would therefore render
**"Speaker 1"** on a Vietnamese page — against a request that named the copy
explicitly.

**Add `ordinal: number` to `SessionSpeaker` and format at render time.** That is a
public type change with 12 consumers in `apps/web` plus 3 spec files, and it is
also what makes P3's "ordinals are `1..k` with no gaps" expressible at all.

### Rename must keep a surface

`SpeakerRoster` holds the only rename UI — its own docstring says that is what it
adds over the chip's picker (`speaker-roster.tsx:20-21`), and the chip exposes
only attribute / unattribute / add-speaker (`speaker-chip.tsx:118,129,136`).
Removing the roster while claiming "rename still reachable" is a contradiction,
and it removes the only human signal P3's authority table exists to protect —
and the only input P6-S2 can read.

**RESOLVED — validation V2: rename moves to the chip.** `SpeakerRoster` leaves
the live flow entirely. The chip already owns a picker; rename joins it, with
commit-on-blur rather than per-keystroke dispatch. This keeps the screen free of
a management panel and gives P6-S2 a real denominator.
<!-- Updated: Validation Session 1 - V2 -->

### The human add path is not bounded by `K_max`

`onAddSpeaker` survives on the chip (`speaker-chip.tsx:136-140`, passed
unconditionally at `conversation-transcript.tsx:178`) and calls `addSpeaker`,
which is bounded only by `MAX_SPEAKERS = 8` (`speaker-roster.ts:96`). A user can
tap past `K_max`. **RESOLVED — validation V3: `K_max` binds the machine mint
path only.** A person knows how many people are in the room; the machine does
not, and the third-voice detector is 36.5% at 5% false alarm. So the human add
action is deliberately **not** capped, and D5's count guarantee is scoped to
machine-generated ordinals. Assert that scoping explicitly, and note that the
roster may therefore legitimately hold more speakers than `K_max`.
<!-- Updated: Validation Session 1 - V3 -->

### The settle pass is a second clustering algorithm and has no measurement

No offline clusterer exists in the repo or the bench — `speaker_bench/` has no
clustering module beyond `online.py`, which is strictly incremental. P1 measures
eight things and none is the settle pass, yet this phase ships it and P6-S3 gates
on its churn. The phase applies "measure before you build" to deferred mint and
exempts the settle pass from it.

**Add a settle-pass arm to P1 (M10)** — offline re-cluster over the same cached
vectors, merge and split error reported separately — or move the settle pass to a
follow-up gated on that measurement. It does not ship on an argument.

## Requirements

**Functional**

- Port `OnlineAttributor` into `packages/realtime-client` with `K_max`,
  `centroid_cap` and deferred-mint parameters set from P1's measured values.
- Above-cap policy per P1-M9 (option A, B or C above), implemented as chosen and
  named in code.
- Attributor state lives on `TurnKeyedTranscript`, serializable, reset-clean.
- Attributor consumes turns in **capture order**, not arrival order.
- `ordinal: number` on `SessionSpeaker`; label formatted at render.
- Genuine no-chip rendering for unattributed turns — not the `fallback` prompt.
- Display groups split on any differing `speakerId`, any origin.
- Mint hygiene: a zero-norm vector (`embedder.py:106-110`) and a
  sub-duration-floor turn can never create a speaker; they may still join.
- `transcript.sessionSettled` action; settle pass with a stated invocation-rate
  bound.
- A rename surface exists after the roster leaves the live flow.

**Non-functional**

- No wire-contract change. No server work. No persistence — plan Constraint 4.
- Settle pass ≤20ms per invocation at 100 turns × 192 dims, **with a stated
  invocation rate**.
- Exactly one `bg-primary` control on `/translate` (plan Constraint 14).

## Related Code Files

- Create: `packages/realtime-client/src/state/online-attributor.ts`
- Create: `packages/realtime-client/src/state/settle-pass.ts` (only if P1-M10 clears)
- Modify: `packages/realtime-client/src/state/speaker-roster.ts` — `ordinal` on
  `SessionSpeaker` (`:36-39`); `K_max` vs `MAX_SPEAKERS` (`:78,:96`); the English
  label fallback (`:99`)
- Modify: `packages/realtime-client/src/state/turn-keyed-transcript.ts` —
  attributor state field; capture-order consumption; `transcript.sessionSettled`;
  mint guards
- Modify: `packages/realtime-client/src/state/display-groups.ts:103-107` — the
  split rule
- Modify: `packages/realtime-client/src/index.ts` — barrel for the changed types
- Modify: `apps/web/src/components/translate/conversation-transcript.tsx:152-179`
  — no-chip path; one chip per group assumption
- Modify: `apps/web/src/components/translate/speaker-chip.tsx` — ordinal
  rendering; rename affordance if chosen
- Modify: `apps/web/src/components/translate/cascade-panel.tsx` — roster removal
  or reduction
- Modify: `apps/web/src/hooks/use-streaming-translate.ts` — label formatting at
  render; `stop` dispatches `transcript.sessionSettled`
- Modify: `packages/i18n/src/vi.ts:179`, `en.ts:189`
- Modify: `apps/extension/src/meeting-transcript.ts` — state the behaviour; the
  shared-literal hazard is real regardless of reachability
- Specs: `online-attributor.spec.ts`, `display-groups.spec.ts`,
  `turn-keyed-transcript.spec.ts`, `speaker-chip.spec.tsx`,
  `speaker-roster.spec.ts`, `conversation-transcript.spec.tsx`

## Implementation Steps

0. **Decide and record:** the above-cap policy (from P1-M9), the rename surface,
   whether `K_max` binds the human add path, and whether the settle pass ships at
   all (from P1-M10).
1. Port the attributor with `K_max`, `centroid_cap`, deferred mint and the chosen
   above-cap policy. State where its state lives.
2. Write the adversarial spec **before** wiring: random, zero, near-duplicate and
   orthogonal vectors; assert the ordinal ceiling and that reset leaves nothing
   behind.
3. Add `ordinal` to `SessionSpeaker`; move label formatting to render; update all
   12 consumers and 3 specs.
4. Add the mint guards with the join/create asymmetry commented.
5. Wire the attributor in **capture order** under P3's authority table.
6. Fix the display-group split rule; spec that two machine ordinals split a
   `cutForced` continuation.
7. Build the genuine no-chip path in `conversation-transcript.tsx`.
8. Settle pass (only if P1-M10 cleared): `transcript.sessionSettled`, bounded
   cadence, merge and split error reported separately.
9. Roster decision from step 0; ensure rename is reachable.
10. State the extension's behaviour and assert `initialTurnKeyedTranscript`
    immutability.
11. Integration test: zero interactions after start → two labelled chips,
    correctly localized.

## Success Criteria

- [ ] Above-cap policy chosen from P1-M9's measured numbers and named in code
- [ ] A session never renders more than `K_max` machine ordinals — asserted
      against an adversarial embedding sequence
- [ ] `K_max` bounds **machine-minted** ordinals only (V3); the human add path is
      uncapped, and the count guarantee is asserted with that scoping
- [x] ~~Unattributed turns render **genuinely no chip** — never the "Ai đã nói?"
      prompt — asserted in `conversation-transcript.spec.tsx`~~ **SUPERSEDED by
      D8.** No turn ends unattributed at all, so there is no terminal state for
      this criterion to describe. The half that survives is the prohibition on
      the tappable prompt, restated below
- [ ] A **pending** ordinal renders as a neutral, non-interactive placeholder —
      never the tappable "Ai đã nói?" prompt, which is the manual flow the user
      rejected — asserted in `conversation-transcript.spec.tsx`
- [ ] **Zero rows end the session pending.** Force-assignment at settle or
      session end is asserted, including on the abandoned-session path
- [ ] Two machine ordinals **split** a `cutForced` merged block — asserted
- [ ] Attributor state lives on `TurnKeyedTranscript`; after `transcript.reset`
      no cluster or ordinal survives — asserted
- [ ] The attributor consumes turns in capture order; an arrival-order shuffle
      produces identical ordinals — asserted
- [ ] `ordinal: number` on `SessionSpeaker`; chips render the localized string on
      a Vietnamese page — asserted, not assumed
- [ ] A zero-norm vector never creates a speaker; a sub-floor turn never creates
      but may join — asserted
- [ ] `K_max` reconciled with `MAX_SPEAKERS`; which binds is stated, and the
      loser's silent-refusal behaviour is specified
- [ ] `centroid_cap` set per P1-M3 **and consistent with it** — if M3 finds no cap
      helps, `None` ships
- [ ] Settle pass ships only if P1-M10 cleared; trigger is
      `transcript.sessionSettled`; invocation rate bounded and stated
- [ ] Settle pass reports merge error separately from split error
- [ ] Rename is reachable **from the chip** (V2), commit-on-blur; `SpeakerRoster`
      is absent from the live flow
- [ ] **Zero user interactions** after start produce two correctly-labelled chips
- [ ] The extension's behaviour is stated; `initialTurnKeyedTranscript`
      immutability asserted
- [ ] Exactly one `bg-primary` control on `/translate`

## Risk Assessment

**Above the cap the product names the wrong person.** ~65% measured
(`guest-summary.csv`). _Signal:_ a third voice in a real session. _Response:_ the
policy is chosen from M9's numbers, not assumed; and D5 no longer claims
abstention. If no option clears D6, that is a stop.

**The abstention path becomes a manual-attribution prompt.** _Signal:_ the
implementation reuses `fallback`. _Response:_ explicit success criterion with its
own spec; the two states are opposites, not variants.

**Two people render under one chip.** _Signal:_ a `cutForced` continuation from a
different speaker. _Response:_ the split-rule fix, asserted — and note that
without it P6-S1 measures the grouping rule rather than the attributor.

**Cluster state outlives the conversation.** _Signal:_ ordinals present
immediately after a fresh `start()`. _Response:_ state lives on the reducer;
reset-cleanliness is asserted.

**Ordinals invert against speaking order.** _Signal:_ the person who spoke first
is `Người nói 2`. _Response:_ capture-order consumption plus an arrival-shuffle
assertion.

**The label ships in English.** _Signal:_ "Speaker 1" on a Vietnamese page.
_Response:_ `ordinal` in state, formatting at render, asserted in a
`conversation-transcript` spec rather than a package unit test that would pass on
the English fallback.

**The settle pass merges two people.** Unrecoverable without user action.
_Response:_ it does not ship until P1-M10 measures it, and merge error is reported
separately from split error.

**Accent sprawl on the translate screen.** _Response:_ explicit success criterion.
