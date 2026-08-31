---
phase: 4
title: 'Bounded-K auto-attribution and settle pass'
status: pending
priority: P1
effort: '6d (was 4d — see Mechanism)'
dependencies: [3]
---

# Phase 4: Bounded-K auto-attribution and settle pass

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

### `K_max` bounds creation. It cannot bound assignment.

`OnlineAttributor.observe` (`speaker_bench/online.py:117-131`) tests in this
order:

```python
if best_score >= self.tau_assign:          # :125  assign + fold
    self._clusters[best].fold(vector, cap=self.centroid_cap)
    return Assignment(label=best, created=False, score=best_score)
if best_score < self.tau_new:              # :128  mint
    return Assignment(label=self._create(vector), created=True, ...)
return Assignment(label=None, ...)         # :130  abstain
```

A cap can only guard `_create` at `:132`. The **assign branch runs first**. So
above the cap a third speaker's turn does not abstain — it is folded into
whichever existing centroid it scores closest to and rendered under that
person's ordinal.

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
- [ ] Unattributed turns render **genuinely no chip** — never the "Ai đã nói?"
      prompt — asserted in `conversation-transcript.spec.tsx`
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
