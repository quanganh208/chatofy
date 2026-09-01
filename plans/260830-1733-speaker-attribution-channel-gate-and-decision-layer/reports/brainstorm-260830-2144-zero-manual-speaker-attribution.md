---
type: brainstorm
date: 2026-08-30
mode: ultra (best-of-5 + verifier)
status: accepted-contract
supersedes_premise_of: plans/260830-1733-speaker-attribution-channel-gate-and-decision-layer/
---

# Zero-manual automatic speaker attribution ("Người N")

**Request:** _"tôi không muốn user phải manual bất cứ chỗ nào, tự động detect,
hiển thị người 1, người 2,... Sau này sẽ lưu lịch sử rồi sửa lại sau thì tuỳ user"_

Produced by `ak:brainstorm --ultra`: five independent candidates over one immutable
evidence packet, scored by a strongest-model verifier against a 4-criterion rubric.
This document is the winning candidate, **materialized unchanged**. The verifier's
ranking and what the choice cost are in the appendix at the end.

---

# Bounded brainstorm contract — zero-manual automatic speaker attribution ("Người 1, Người 2, …")

Every number below was re-verified against files in this repo during this session. Where a number is _not_ in the repo I say "unmeasured" and put it in the plan instead of guessing. Two of the evidence packet's own claims turned out to be wrong; both corrections are flagged inline.

---

## 0. Two corrections to the evidence packet, before anything is built on it

**C1 — "Measured turn length p50 1163ms, p95 2983ms" is not a turn length.**
`packages/realtime-client/src/audio/speech-gate.ts:4-6` reads: _"Measured end to end over 32 turns, **from the moment the speaker stops to the first sample of translated audio**: p50 1163ms, p95 2983ms."_ Same figure at `docs/development-journey.md:963`, in a latency table with a per-stage split (STT 58ms, translate 723ms, TTS 527ms). That is pipeline latency, not speech duration.

**The product's turn _audio_ duration distribution is unmeasured anywhere in this repo.** This matters more than it looks: the entire session bench scores clips truncated to exactly **2.0 s** (`benchmarks/speaker-id/scripts/build_embedding_cache.py:56 TURN_S = 2.0`, applied at `:143 truncate_to(...)`), and far-field EER moves from **0.2307 at 2.0s to 0.2767 at 1.0s** for campplus (`results/pairwise-summary.csv`). So every cold number in the packet is conditional on real turns being ≈2s. If the median real turn is 1.2s, every cold cell is optimistic by an unknown amount.

The fix is nearly free: `apps/api/.../translation-session.service.ts:356` already computes `audioMs: Math.round(audio.secondsAt(audio.byteLength) * 1000)` and ships it in `server.turn.embedding`. The client already stores it (`turn-keyed-transcript.ts:402-405`). **Measuring the real turn-duration histogram costs one instrumented session, not a corpus.** It is task #1 of any plan here.

**C2 — the label string is not "Người N".**
`packages/i18n/src/vi.ts:179` is `'web.translate.speakerDefault': 'Người nói {number}'` (en: `'Speaker {number}'`, `en.ts:189`). The user asked for "người 1, người 2". That is a one-line copy edit, not a feature — but it is currently rendered only via `addSpeaker`, a **UI callback** at `apps/web/src/hooks/use-streaming-translate.ts:342-346`, which is the single dispatch site of `transcript.speakerAdded` in non-test code (verified by grep across `apps/` + `packages/src`). No code path anywhere creates a speaker from audio.

---

## 1. The crux, stated in one paragraph

The user's request has exactly one hard technical obstacle, and it is not accuracy. **`tau_new` is a single knob that trades speaker _discovery_ against speaker _over-count_, and the measurements show both ends of it, neither acceptable:**

| calibration regime            | `tau_assign` / `tau_new` | what it buys                                 | what it costs                                                                                       | source                                                   |
| ----------------------------- | ------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| cold (must discover everyone) | 0.35 / 0.30              | attribution 0.923, accuracy 0.770            | **mean \|ΔN\| = 1.160** — a 3-person chat renders ≈4 chips                                          | `session-summary.csv`, campplus far-field 3 cold split 0 |
| warm (count must stay stable) | 0.30 / 0.15              | enrolled accuracy 0.914, spurious-new 0.0013 | a genuine **stranger gets their own cluster 6.40 % of the time**; 64.92 % stolen, 28.68 % undecided | `guest-summary.csv`, campplus far-field, 2 enrolled      |

Those two rows are the same algorithm, same model, same condition. Set `tau_new` high enough to notice a new person and it invents people who are not there; set it low enough to hold the count and it never notices a real new person. **No measured setting does both.** The existing plan's `phase-04:24` states the consequence flatly: _"Acoustics cannot detect a stranger… A person can."_ — and it names roster closure as the fix. **Zero-manual means the roster is never closed by a person.** That is the collision, and it is the thing this contract has to route around, not argue with.

And the user's requested UI is the exact surface that _renders_ this failure. Under a named roster an extra cluster is invisible (`suggestSpeaker` just returns `null`). Under "Người 1, Người 2, …" **the labels ARE the speaker count.** Every count error is on screen.

---

## 2. Contract

### 2.1 Outcome (user-visible end state)

A Chatofy conversation where **nobody touches anything to make speaker labels appear.**

1. User starts a conversation and speaks. No roster UI, no tap-to-seed, no enrolment ceremony, no "add speaker" button in the primary flow.
2. Each finalised turn is rendered with one of exactly three states:
   - an ordinal chip **"Người 1" / "Người 2" / …** (`vi.ts:179`, retitled per C2),
   - **no chip at all** (undecided — the dead zone), rendered as today's `fallback` tone, `speaker-chip.tsx:57`,
   - a chip the _user themselves_ changed later (the existing `confirmed` tone).
3. Ordinals are assigned in first-appearance order, per session.
4. When the conversation pauses or ends, the labels **settle**: a whole-session pass may merge two ordinals into one, split one, or fill in previously-undecided turns. A chip the user has personally touched is never moved (existing decision D2, `plan.md`).
5. The user _may_ rename or re-attribute afterwards — the existing `renameSpeaker` / `attributeTurn` / `removeSpeaker` callbacks (`use-streaming-translate.ts:346-360`) stay, unchanged, as the user's own escape hatch ("sửa lại sau thì tuỳ user"). They are an **option**, never a prerequisite.
6. Nothing new leaves the browser. The `/embed` call is the only server hop and it already exists.

### 2.2 Constraints that actually bind

| #   | Constraint                                                                                                                                                                                                                                                                                                                                                                         | Evidence                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| K1  | **The count bar is the binding bar, not accuracy.** Cold N=3 far-field clears accuracy (0.770/0.783/0.787 ≥ 0.70) and attribution (0.923/0.944/0.934 ≥ 0.80) on **all three splits**, and fails `COUNT_ERROR_MAX = 1.0` on two (1.1600, 0.5450, 1.2575).                                                                                                                           | `results/session-summary.csv`; bars at `run_session.py:52-54`          |
| K2  | **Cold N=5 has no operating point at all.** campplus: NO-CONFIG on all 6 cold cells (clean + far-field × 3 splits). eres2netv2: NO-CONFIG on 1 of 6, and the 5 that calibrated all **FAILED** at evaluation with \|ΔN\| 1.6875–2.7175. Zero passing cold N=5 cells out of 12.                                                                                                      | `session-summary.csv`; NO-CONFIG semantics at `run_session.py:231-252` |
| K3  | **Cold accuracy decays; warm does not.** campplus far-field N=3 cold, per turn ordinal: t0 332/400 = **0.830** → t5 271/357 = 0.759 → t9 271/372 = 0.728 → t14 270/379 = **0.712**. Warm same cell: t0 296/326 = 0.908 → t14 311/347 = **0.896**.                                                                                                                                  | `results/session-coldstart.csv`                                        |
| K4  | **The decay plateaus, it does not free-fall — but for N=5 it plateaus _below the accuracy bar_.** eres2netv2 far-field N=5 cold runs 25 ordinals: 0.818 at t0, then flat in 0.664–0.717 from t8 to t24. t24 = 250/375 = **0.667 < ACCURACY_BAR 0.70**.                                                                                                                             | `session-coldstart.csv`                                                |
| K5  | **Beyond 15 turns (N=3) / 25 turns (N=5) is unmeasured.** `MEETING_TURNS = 5` × size is the whole session. Real Chatofy sessions are longer. No number exists.                                                                                                                                                                                                                     | `run_session.py:65`                                                    |
| K6  | **N=2 has never been measured.** `MEETING_SIZES = (3, 5)`. The plan's own D3 says real size is 2-3.                                                                                                                                                                                                                                                                                | `run_session.py:68`; `plan.md` D3                                      |
| K7  | **The browser DSP channel is unmeasured.** `open-microphone.ts:57-61` sets `echoCancellation/noiseSuppression/autoGainControl` all true; `AudioContext` takes the OS default rate (`use-streaming-translate.ts:205`, no options) and is downsampled per block (`conversation-session.ts:446,468`). No corpus number passed through any of it. This is why the flag ships off.      | verified by read                                                       |
| K8  | **All bench numbers were produced on a different machine.** `results/embedding-cache.log` last line writes to `/home/quanganh208/Documents/QuangAnh/chatofy/…`. `benchmarks/speaker-id/` has no `corpora/`, `models/`, `fixtures/`, or `embedding-cache.npz` here. Any re-run starts with a gated corpus fetch + model download + cache build.                                     | verified by `ls`                                                       |
| K9  | **The evaluation pool is small.** `embedding-cache.log`: `spread` policy = 76 speakers / 488 clips, median 5 clips/speaker, only **30 speakers have ≥8 clips** (`MIN_CLIPS = ENROLL_TURNS 3 + MEETING_TURNS 5`). After the disjoint split, `speakers_evaluated = 15` per cell. 400 meetings are drawn from ≤120 distinct clips. Treat split-to-split spread as the real error bar. | `run_session.py:66,105-115`; `session-summary.csv`                     |
| K10 | **The far-field condition is synthetic**, image-source shoebox, room 2.00 m, RT60 0.507 s, stacked on already-processed corpus audio.                                                                                                                                                                                                                                              | `embedding-cache.log`                                                  |
| K11 | **Meetings are uniformly shuffled, not conversational.** `run_session.py:158 rng.shuffle(schedule)`, each speaker contributing exactly 5 turns. Real two-person dialogue alternates. Whether alternation helps or hurts online clustering is unmeasured.                                                                                                                           | verified by read                                                       |
| K12 | **Latency budget: campplus p95 183.5 ms** at `contended-stt8`, extractor_threads=2, 3.0 s audio (124.6 ms at 2.0 s). eres2netv2 at the equivalent `contended-stt4` cell is 517.0 ms vs campplus 132.2 ms = **3.91×** for **0.1 EER points** (23.07 % vs 23.06 %, far-field 2 s). Model swap is not the axis.                                                                       | `results/latency-container-2decode.csv`, `pairwise-summary.csv`        |
| K13 | **`AttributionOrigin` is a compile-time public contract.** `speaker-roster.ts:33` `'confirmed' \| 'suggested' \| 'fallback'`, consumed by an exhaustive `Record<AttributionOrigin, string>` at `speaker-chip.tsx:52-58`. Adding a member breaks `apps/web` at build time — which is the desired forcing function, but it is a public-barrel change.                                | verified by read                                                       |
| K14 | **Write-once blocks re-scoring today.** `turn-keyed-transcript.ts:410` returns early if any attribution exists for a turn. Any settle pass requires relaxing this for non-confirmed rows.                                                                                                                                                                                          | verified by read                                                       |
| K15 | **Whole-session embeddings are already in the client, for free.** `turn-keyed-transcript.ts:402-405` accumulates `state.embeddings[sessionId] = {vector, audioMs}` additively and never evicts. **An offline re-cluster needs no persistence, no server call, no new biometric egress.**                                                                                           | verified by read                                                       |
| K16 | **There is no persistence and no diarization library.** `apps/api/prisma/schema.prisma` has exactly one model (`User`, `:26`). Grep for `pyannote\|diariz\|spectral_cluster\|AgglomerativeClustering` across `services/ benchmarks/ apps/ packages/` returns **nothing**.                                                                                                          | verified                                                               |
| K17 | **Privacy.** Embeddings are voice biometrics, session-scoped, of a counterpart who never touches the product. `attribution-stats.ts:48-53` states the no-analytics contract. Any cross-session template is a new consent surface.                                                                                                                                                  | verified by read                                                       |
| K18 | Corpora are `cc-by-nc-4.0`, evaluation-only. No Vietnamese-trained speaker embedder is published. Whether Chatofy is commercial is **unresolved** and decides whether NC assets are usable at all.                                                                                                                                                                                 | packet; not independently re-verified this session                     |

### 2.3 Non-goals

1. **Not** persisted transcript history. K16: Prisma has one model. The settle pass runs on in-memory `state.embeddings` (K15). History storage is a separate delivery the user has already deferred ("sau này sẽ lưu lịch sử").
2. **Not** an embedding-model swap or a new-weights screen. K12 prices it. (Existing P5 stays parallel and abandonable.)
3. **Not** training a Vietnamese embedder. K18.
4. **Not** within-turn diarization. `speech-gate.ts` segments on silence only; there is no speaker-change detector anywhere (K16). One turn = one speaker stays an assumption; two people talking over each other is out of scope and must be named as a known limitation, not silently absorbed.
5. **Not** analytics or telemetry. K17.
6. **Not** `apps/extension`. It never sends `embedSpeaker` (grep across `apps/extension/src`: zero hits) and holds two `TurnKeyedTranscript` instances keyed by direction (`meeting-transcript.ts:39-42`). Different problem, different premise.
7. **Not** removing the existing manual affordances. They stay as the user's own hatch. Removing them would make a wrong label permanent.
8. **Not** re-arguing tap-to-seed as the primary flow. Settled.

### 2.4 Acceptance criteria

Split into three gates. Each names the metric, the bar, and where it is read.

#### Gate M — measurement (bench, no product code)

All in `benchmarks/speaker-id/`, after environment restoration (K8), with `SPEAKER_BENCH_REQUIRE_PARITY=1 uv run pytest` exit code recorded (inherited from existing P1).

| #   | Criterion                                                                                                                                                | Bar                                                                                      | Where read                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| M1  | Real turn-duration histogram from ≥3 instrumented production sessions, p10/p50/p90                                                                       | reported, no bar — it **selects** the bench's `TURN_S`                                   | new: `audioMs` already on the wire, `translation-session.service.ts:356`                             |
| M2  | N=2 cold, both conditions, at the `TURN_S` M1 selects                                                                                                    | accuracy ≥ 0.70, rate ≥ 0.80, and the **tightened count bar** below                      | new `MEETING_SIZES = (2, 3, 5)` row in `session-summary.csv`                                         |
| M3  | **Tightened count bar for the anonymous-label product**: mean \|ΔN\| ≤ **0.25**, AND fraction of meetings with `clusters > true_speakers` ≤ **10 %**     | see §3.1 for why 1.0 is the wrong bar here                                               | `SessionScore.speaker_count_error`, `online.py:165-167`; the per-meeting fraction is a new aggregate |
| M4  | **Prefix-locked accuracy reported alongside Hungarian accuracy**, and the gap between them stated                                                        | gap reported; live gate uses prefix-locked only                                          | new scorer beside `score_session`, `online.py:169`                                                   |
| M5  | Deferred-mint arm (`k`-turn corroboration before an ordinal becomes visible) measured at k ∈ {1,2,3}                                                     | must move mean \|ΔN\| under M3's bar at N=2 and N=3 **without** dropping rate below 0.80 | new arm in `run_session.py`                                                                          |
| M6  | Owner-only partial seeding arm: seed **1 of N** members, not all                                                                                         | reported vs cold and vs full-warm at N=2 and N=3                                         | two-line change to `run_session.py:146-149`                                                          |
| M7  | Offline whole-session re-cluster arm (global clustering over all turn vectors, Hungarian-scored, permutation-only) vs the online arm                     | ≥ the online arm on accuracy AND on M3's count bar, at N=2/3/5                           | new probe; consumes the same cache                                                                   |
| M8  | Session length extended to ≥40 turns at N=2 and N=3                                                                                                      | accuracy at the last ordinal decile ≥ 0.70 and not still falling                         | `session-coldstart.csv` extended past K5's horizon                                                   |
| M9  | Channel delta (existing P2, unchanged): Δ EER / Δ top-1 / target-mean cosine loss, DSP-on vs DSP-off, reported as a **leave-one-speaker-out worst case** | verdict only, never an offset (`run_channel_delta.py:52-56`)                             | existing harness                                                                                     |

**Gate M stop rule:** if M5 and M7 both fail M3 at N=2, zero-manual live labels are dead and Approach F (§4) is what ships. Say so out loud rather than relaxing M3.

#### Gate P — product (code, tests, no flag flip)

| #   | Criterion                                                                                                                                                                                                                       | Check                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| P1  | `AttributionOrigin` widened, and every exhaustive consumer updated. `pnpm -F @chatofy/web typecheck` passes.                                                                                                                    | K13 makes this mechanical — the compiler names every site         |
| P2  | A machine-minted speaker is **visually distinguishable** from a confirmed one at a glance, and from a suggestion. Existing tones at `speaker-chip.tsx:52-58` extended, not overloaded.                                          | design review + spec                                              |
| P3  | Exactly **one** `bg-primary` accent-filled control on `/translate` after the change.                                                                                                                                            | `docs/design-guidelines.md`; `.claude/rules/development-rules.md` |
| P4  | Write-once (`turn-keyed-transcript.ts:410`) relaxed for non-`confirmed` rows only. A spec asserts a `confirmed` attribution survives a settle pass unchanged.                                                                   | new spec beside `turn-keyed-transcript.spec.ts`                   |
| P5  | Renumbering is deterministic and total: after a settle pass, ordinals are 1..k with no gaps and no reuse of a retired number within the session. `nextSpeakerNumber` (`use-streaming-translate.ts:344`) reconciled or replaced. | new spec                                                          |
| P6  | The settle pass is pure and synchronous over `state.embeddings`; no network call, no persistence, no new server contract.                                                                                                       | code review + K15                                                 |
| P7  | Zero new user-facing controls in the primary flow. Roster UI and "add speaker" removed from the default path (kept behind the correction affordance).                                                                           | UI diff                                                           |
| P8  | i18n: `vi.ts:179` reads the ordinal form the user asked for; `en.ts:189` parity; i18n key-parity spec passes.                                                                                                                   | existing i18n spec                                                |

#### Gate S — ship (real sessions)

**The inherited P6 gate is undefined under this premise and must be replaced.** It gates on `confirmedMatching : corrected ≥ 4:1` and `tap rate ≥ TAP_RATE_FLOOR = 0.5` (`attribution-stats.ts:36`, plan `phase-06`). In a zero-manual product the tap rate is **≈0 by design**, so both terms have a zero denominator. Replacing it is mandatory, not optional.

| #   | Replacement criterion                                                                                          | Bar                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| S1  | Over ≥10 real sessions, **observed chip count vs. the operator's written-down true speaker count**             | mean \|ΔN\| ≤ 0.25, no session over by ≥2                                                       |
| S2  | **Correction rate**: fraction of machine-minted labels the user subsequently merged, renamed, or re-attributed | ≤ 20 %                                                                                          |
| S3  | **Post-settle churn**: number of ordinal changes a user sees _after_ a turn has been on screen ≥5 s            | reported; if it exceeds ~1 per 10 turns the settle pass ships end-of-session only, not on-pause |
| S4  | Speaker-embedding p95 in production                                                                            | ≤ 200 ms (K12 headroom: 183.5 ms measured)                                                      |
| S5  | Same no-egress reading as today: no new network call introduced by the settle pass                             | code + network trace                                                                            |

S1–S3 are read by a human running sessions and writing numbers down, exactly as `attribution-stats.ts:48-53` requires. That is a real cost and it is the price of the no-analytics contract.

---

## 3. Two interpretive questions the contract had to settle

### 3.1 The inherited count bar is too loose for the product the user asked for

`COUNT_ERROR_MAX = 1.0` (`run_session.py:54`) was written for a product where an extra cluster is invisible — `suggestSpeaker` either returns a roster id or `null` (`speaker-centroids.ts:115-131`) and never creates anything. Under a named roster, "on average one extra latent cluster" costs nothing on screen.

Under "Người 1, Người 2, …" **the clusters are the UI.** A mean \|ΔN\| of 1.0 means the average conversation shows one phantom person. `run_session.py:18-20` already says the quiet part: _"One person appearing under two names is a visible product failure."_ It just set the bar at the wrong place for a product where that failure is the whole screen.

So M3 tightens it to mean \|ΔN\| ≤ 0.25 plus a per-meeting over-count rate ≤ 10 %. This is a **harder** bar than the one cold N=3 already fails, and I am proposing it knowingly: it is the bar the user's requested UI actually implies. Anyone who wants to ship against 1.0 should say out loud that they are shipping a phantom chip per conversation.

For calibration: full-warm N=3 far-field already clears 0.25 on all three splits (0.0600, 0.0175, 0.0075). So the bar is not unreachable — it is reachable _with identity_, which is the whole tension.

### 3.2 The Hungarian remap — my reading

**Hungarian is legitimate as a _permutation_ allowance and illegitimate as a _label-assignment oracle_. Which one it is depends on whether the product can renumber.**

- **For live streaming labels: illegitimate.** `score_session` (`online.py:186-206`) runs `linear_sum_assignment` on the full-session contingency table _after_ seeing all ground truth. The live product cannot do this: `nextSpeakerNumber` (`use-streaming-translate.ts:344`) is a monotone roster counter, an ordinal is fixed at mint time, and the viewer has already read it. So the live path must be scored with a **prefix-locked mapping**: a cluster is owned by the true speaker who created it, fixed at creation, never revised. That is M4. The gap between Hungarian and prefix-locked accuracy is exactly the credit the oracle is contributing, and it is currently unknown — nobody has computed it. Do not assume it is small.
- **For the settled/offline view: legitimate.** Once the product itself runs a whole-session re-cluster and renumbers, permutation invariance is a property the product genuinely has, and Hungarian is standard diarization practice. But it is still an **upper bound**, because Hungarian picks the mapping with ground truth in hand while the product picks it from acoustics alone. The honest statement is: Hungarian-scored offline numbers are the ceiling of the settled view, not its value.

The earlier plan withdrew the `online.py` numbers for three reasons (`plan.md`, "What this plan does NOT claim"): minting, folding, and the Hungarian remap. **The user's decision dissolves the first two** — minting and folding are now the requested product, not a bench artefact. **Only the third survives**, and §3.2 scopes it. That is the honest status of those numbers: partially rehabilitated, still oracle-inflated on the live path by an unmeasured amount.

### 3.3 Resolving the Checkpoint-1 / session-bench contradiction

Checkpoint 1 KILLed on 49.5 % attribution because the turn-vs-turn dead zone is 0.2775 wide (`pairwise-summary.csv`, eres2netv2 far-field 2.0s: `tau_hi 0.471692`, `tau_lo 0.194151`). The session bench sees 0.92–0.94 because it compares a turn against an **accumulated centroid**, and averaging moves the target distribution up much faster than the non-target: campplus far-field target mean **0.4212 → 0.5621** from 1 to 5 turns while non-target mean moves only **0.1768 → 0.2450** (`centroid-growth.csv`). Separation 0.244 → 0.317. A narrower dead zone therefore suffices.

**Both numbers are correct; neither cancels the other.** And the sting for the _cold_ path: every speaker's first turn produces a **one-element** centroid — exactly the `centroid_turns = 1` column, EER 0.1723 — which is why cold starts at 0.830 and warm at 0.908 (K3).

Two honesty notes I will not skip:

- centroid-growth uses **33 speakers / 325 target scores**; pairwise-2s uses **76 speakers / 2844 pairs**. Fewer confusable non-targets mechanically lowers EER. **The two EERs are not directly comparable**, so "1-turn centroid beats turn-to-turn" is confounded and should not be quoted as a gain.
- The 0.1723 → 0.1327 → 0.1503 movement across 1→4→5 turns runs on a shrinking sample (325 → 226 → 193 target scores). At 226 scores an EER near 13 % carries roughly ±2.3 points of standard error, so the whole movement is under two standard errors. **Do not claim "saturation at 4."**

---

## 4. Approaches

Compared on the **worst plausible** case, not the best.

### Approach A — ship `online.py` as-is, live, cold

Port `OnlineAttributor` (130 lines, already written and tested) into the client. Mint on `best_score < tau_new`, fold on `>= tau_assign`, undecided between. Ordinal from `nextSpeakerNumber`.

- **Most load-bearing assumption:** the cold thresholds calibrated on 2.0 s corpus clips, 15-speaker pools, synthetic RT60 0.507 s reverb, and uniformly-shuffled meetings, transfer to browser-DSP audio at unknown real turn lengths, at N=2, over sessions longer than 15 turns.
- **Fails first at:** the count bar, which it already fails on measured evidence — 2 of 3 cold N=3 splits (\|ΔN\| 1.1600, 1.2575 vs bar 1.0), before any of K5/K6/K7 is even applied. And it fails it **on screen**.
- **Worst plausible case:** a two-person Vietnamese conversation over a laptop mic renders 4–5 chips, degrading as it goes (K3), and the ordinals cannot be taken back because they were already read. The user's first reaction is that the feature is broken — which is the same reaction, in a louder form, that the current silent cold state avoids.
- **Cost to build:** lowest of the three. **Cost to abandon: highest** — ordinals are the product surface, and rolling back means the labels a user saw were wrong.
- **Verdict: reject.** It is the literal request and it is the one option the existing measurements already refute.

### Approach B — deferred-mint + capped fold, live only

A + two mechanism changes, both aimed squarely at the count bar:

1. **Corroboration before visibility.** A turn below `tau_new` opens a _provisional_ cluster that has **no ordinal and renders no chip**. It becomes "Người k" only after a second turn independently agrees with it. A provisional cluster that never gets corroborated is discarded and its turn stays undecided.
2. **`centroid_cap` set to a measured value** rather than `None`. `online.py:88-96` already implements the cap and says the right value is an empirical question; the baseline was unbounded. Capping bounds how far a poisoned centroid can drag a session — the mechanism behind K3's decay.

- **Why this attacks the right thing:** over-count is spurious _singleton_ clusters — a turn that fell below `tau_new` but actually belonged to an existing speaker. Requiring k≥2 converts most of those into undecided turns. That trades attribution rate for count error, and **the headroom is in the right direction**: cold N=3 far-field currently runs 0.923–0.944 attribution against a floor of 0.80, i.e. **12–14 points of slack**, while over-count is only 0.16–0.26 above its bar.
- **Most load-bearing assumption:** that the trade is favourable — that k=2 costs less than 12 points of rate and buys more than 0.26 of count error. **This is a hypothesis, not a measurement.** No arm in this repo implements it (verified: `online.py` has no corroboration path).
- **Fails first at:** N=5, where the count problem is not marginal but structural — 12 of 12 cold cells failed or found no config (K2). Corroboration shrinks over-count; it does nothing about the _under_-count and confusion at N=5, where even the passing configs sat at \|ΔN\| 1.69–2.72. Second failure point: the decay (K3) is caused by folding wrong turns into centroids, and corroboration filters _creation_, not _assignment_ — a turn above `tau_assign` still folds whether or not it is right. The cap only bounds the damage.
- **Worst plausible case:** at N=2 it works, at N=3 it is marginal, at N≥4 it degenerates into mostly-blank chips — which is a _quiet_ failure (missing labels) rather than a _loud_ one (phantom people). That is a strictly better failure mode than A, and it matters.
- **Cost to build:** ~20 lines in `online.py` for the bench arm; a modest client reducer change. **Cost to abandon: low if measured first** — the bench arm is Python, throwaway.

### Approach C — B + whole-session settle pass (recommended shape)

B, plus: on pause and at end-of-session, run a **global clustering over all of `state.embeddings`** (K15 — they are already all there, no persistence needed) and write results back to every non-`confirmed` turn.

What the settle pass genuinely buys, precisely:

- It sees turn _n+50_ when deciding turn _3_. The online path cannot. Two clusters that the online greedy split because the first turn of each was noisy can be merged once both have 10 turns and clean centroids — and the centroid-growth data says that is exactly when separation is best (target 0.4212 → 0.5621 vs non-target 0.1768 → 0.2450).
- It can **renumber**, which makes §3.2's permutation allowance a real product operation rather than a scoring oracle.
- It converts undecided turns into labelled ones after the fact — attacking the exact coverage cost B pays.
- It costs **zero embedding latency** (no re-embedding: vectors are cached) and **zero new network egress** (K15, S5). 192-dim vectors × a few hundred turns is microseconds of JS arithmetic.

What it does **not** buy:

- It does not un-ring the bell. A live viewer already read "Người 4". `use-streaming-translate.ts:344`'s counter never renumbers today; making it renumber creates **visible churn**, which is a new UX failure mode (hence S3).
- It does not fix identity, only consistency. Two people who genuinely sound alike stay merged offline as surely as online.
- Its Hungarian-scored numbers are a **ceiling**, not a value (§3.2).
- **It is entirely unmeasured.** No offline arm exists in `benchmarks/speaker-id/`; no diarization library is installed (K16). M7 has to be written from scratch.

- **Most load-bearing assumption:** global clustering with full-session evidence beats online greedy by enough to clear M3. Plausible on the centroid-growth mechanism, unproven here.
- **Fails first at:** churn. If the settle pass renumbers aggressively on every pause, the user watches labels shuffle and trusts none of them — a worse product than silence. Mitigation is in the criterion: S3 measures it, and if it exceeds the bar the pass demotes to end-of-session only, where the user is reading history and the churn is invisible. **That demotion path is exactly the user's own escape hatch** — "lưu lịch sử rồi sửa lại sau" — reached without asking them for anything.
- **Worst plausible case:** the live path is B (blank chips at high N), and the settle pass moves nothing measurable, so the added complexity buys nothing. Cost of that outcome: one bench probe (M7) plus a client function, both deletable.
- **Cost to abandon:** low, and the abandonment is _graceful_ — dropping the settle pass leaves B working.

### Approach D (orthogonal, not standalone) — owner-only passive seeding

Not a fourth path; a modifier that stacks on B or C, and the single highest-leverage unmeasured idea in this analysis.

Enrolment collapses count error by **~20×** at N=3 far-field (cold 1.1600 → warm 0.0600) and flattens the decay curve entirely (K3). But `run_session.py:146-149` seeds **every** member. **Seeding one of N has never been measured**, and it is a two-line change to that loop.

The product relevance: the account holder is the only person Chatofy can identify without a ceremony. Their centroid can accrue silently from their own past turns. In the dominant N=2 case that means **one seeded cluster plus one discovered cluster** — the discovery problem shrinks from "find k unknown people" to "notice one other person," which is the easiest version of the problem the mechanism has.

- **The honest tension, which I will not resolve for the user:** a cross-session owner template is a persisted voice biometric (K17), and persisting biometrics requires explicit consent. A one-time consent checkbox is _a manual act_. It is not the per-conversation manual act the user rejected, but it is not literally zero either. **This is a product/legal decision, not a technical one, and it belongs to the user.** A session-scoped variant (owner seeded from their own first 2–3 turns of the _current_ session) avoids persistence entirely but gives up most of the benefit, since it is warm only after the cold period has already done its damage.
- **Second orthogonal prior, cheaper still:** in **live** mode, `server.live.transcript` already carries `lang: languageCodeSchema` — _"the language the model DETECTED"_ (`packages/types/src/events/live-ws-events.ts:80-91`). In a bilingual two-person conversation, detected language is a **free, zero-manual, zero-biometric per-turn identity prior**. It is worthless in a Vietnamese–Vietnamese conversation, and the **cascade** path has no per-turn language field at all (direction is a session-level `'vi_to_en' | 'en_to_vi'` setting, `packages/types/src/domain/transcript.ts:11`). Worth one measurement, not worth a design. Note also that `speakerRoleSchema = z.enum(['speaker_a','speaker_b'])` already exists at `packages/types/src/domain/session.ts:4` and is unused by the turn-keyed path — the two-speaker framing is already in the domain vocabulary.

### Approach F — the honest fallback, if Gate M says no

The user rejected manual tapping. So the fallback must not be "tap anyway." It is:

**Ship no live labels. Ship the settled view only.** Live turns render with no chip at all — identical to today's cold behaviour, which is silence, not a wrong guess (`speaker-centroids.ts:118-131`). When the conversation ends, run the settle pass and present the grouped result _once_, as a reviewable summary the user can accept or edit. Nothing is manual during the conversation; the only interaction is optional, afterwards, and it is exactly the interaction the user already sanctioned ("sửa lại sau thì tuỳ user").

If even the offline pass fails M3 at N=2 — the easiest cell, the dominant case, the friendlier corpus channel — then **the honest answer is that this cannot be built today with these weights on this host, and `SPEAKER_EMBEDDING_ENABLED` stays false.** Report which measurement said no, in one line, and stop. Do not ship an average phantom person per conversation and call it auto-detect.

---

## 5. Recommendation

**Take Approach C's shape, but the first deliverable is a bench arm, not product code.**

Reasoning, against the rule "prefer the approach cheapest to abandon when a load-bearing assumption cannot be resolved now":

- Every approach here rests on assumptions that **cannot be resolved from the repo**: N=2 unmeasured (K6), real turn length unmeasured (C1), the DSP channel unmeasured (K7), deferred-mint unmeasured, offline re-clustering unmeasured, one-of-N seeding unmeasured.
- The product code for A/B/C is a **compile-time public-contract change** (K13) plus a relaxation of write-once (K14) plus UI. Abandoning it after building is expensive.
- The bench arms for M5/M6/M7 are Python against a cache that already has a builder. They are **the cheapest thing in this analysis to abandon.**
- And M5/M6/M7 are cheap for a second reason: they share one environment restoration (K8), which has to happen exactly once regardless of which approach wins.

**Ordering:**

1. **M1 first** (turn-duration histogram). It is the cheapest measurement, it needs no corpus, and it _selects the bench's `TURN_S`_. Every other cell is conditional on it. Running the bench before M1 risks re-measuring the wrong duration for a second time.
2. **Environment restoration** (K8) — real work, not a prerequisite to hand-wave. Existing P1 already prices this at 2–3d.
3. **M2 + M4** — N=2 cold baseline with both scorers. This is the go/no-go on whether the dominant case is even in the neighbourhood. If N=2 cold under prefix-locked scoring is far from M3, stop before building anything.
4. **M5, M6, M8 in parallel** — deferred-mint, one-of-N seeding, extended session length. All three are edits to `run_session.py` and `online.py` against the same cache.
5. **M7** — the offline arm. New probe.
6. **M9 / existing P2** — the channel gate. Unchanged, still the hard gate, still one-shot, still requiring consent and a retention date before anyone is recorded.
7. Only then Gate P, then Gate S.

**Smallest thing that satisfies the contract:** if M5 alone clears M3 at N=2 and N=3, ship **B** and skip the settle pass. C's extra machinery is only justified by M7 showing a measurable gain. Say that up front so nobody builds the settle pass out of momentum.

**Explicit answers to the required questions:**

- **Speaker-count error:** it is the binding constraint, the inherited bar (1.0) is too loose for this UI, and M3 tightens it to 0.25 + a 10 % per-meeting over-count cap. Deferred-mint (B1) is the concrete mechanism aimed at it, and it trades attribution-rate slack (12–14 points available) for count error (0.16–0.26 needed).
- **N=5 NO-CONFIG:** it means **an unbounded speaker count is not deliverable cold on this evidence.** Zero of 12 cold N=5 cells pass across both models. The product must therefore ship with a stated, visible degradation at high N — blank chips, not invented people — and must not advertise unlimited speakers. The nuance I will not hide: NO-CONFIG is measured against the _calibration_ target (rate ≥ 0.94, `run_session.py:231`), not the 0.80 shipping floor, so a config _might_ exist at a lower rate. But eres2netv2's five N=5 cold configs that **did** calibrate all then blew the count bar at evaluation (\|ΔN\| 1.69–2.72), so relaxing the margin is unlikely to rescue it. That is a hypothesis; M2's grid can confirm or refute it in the same run.
- **Cold degradation (0.830 → 0.712 over 15 turns):** caused by `fold` self-training on its own mistakes (`online.py:126`). Two things arrest it, neither proven: `centroid_cap` (B2, implemented but never measured — `online.py:88-96` calls the right value "an empirical question"), and identity (warm is flat: 0.908 → 0.896). K4 adds that the decay **plateaus** rather than collapsing — at ~0.72 for N=3, but at **0.667, below the accuracy bar**, for N=5. And K5: beyond 15/25 turns nobody knows.
- **N=2 unmeasured:** stated plainly, it is the product's dominant case (plan D3), and it is M2 — the first cell measured after restoration. Note the structural fact that at N=2 a single spurious cluster is \|ΔN\| = 1, i.e. **exactly at the inherited bar** — which is another reason the inherited bar is wrong here.
- **Can "zero manual" coexist with an identity source:** yes, three ways, in descending confidence — (a) **corroboration** (B1) supplies no identity but removes the failure identity was fixing; (b) **owner-only passive seeding** (D) supplies real identity with no per-conversation act, at the cost of a one-time consent decision the user must make; (c) **detected language in live mode** (`live-ws-events.ts:80-91`) is free and biometric-free but only works bilingually and does not exist on the cascade path.
- **The offline re-clustering pass:** it is genuinely different from the online path — it sees all turns at once, it costs zero latency and zero egress because the vectors are already in `state.embeddings` (K15), and it makes the Hungarian permutation legitimate as a product operation rather than an oracle. It does **not** fix identity, does **not** un-show a wrong live label, and is **completely unmeasured** (K16). Its Hungarian numbers will be a ceiling.
- **The fallback:** Approach F. Live silence + a settled end-of-session view, reached without ever asking the user to tap. If even that fails M3 at N=2, the honest output is "not buildable today, flag stays off, here is the measurement that said so."

---

## 6. What happens to `plans/260830-1733-speaker-attribution-channel-gate-and-decision-layer`

**Amended, not superseded.** Four of six phases survive; two need surgery. The plan's premise (human-seeded named roster, confirmed-only centroids, roster closure as a social guarantee) is reversed by the user's decision, but most of its _work_ is premise-independent.

| Phase                                      | Fate                                                      | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1** Measure target cells                | **Amended — its core definition inverts**                 | P1 defines "product-faithful" as _"assign-or-abstain only — no `tau_new`, no minting… no folding… no Hungarian remap"_ (`phase-01-measure-target-cells.md:26-34`). Minting and folding are now **the requested product**. That requirements block must be rewritten to M1–M8. **Survives intact:** the N=2/N=3 cells, environment restoration (correctly re-scoped from 0.5d to 2–3d), per-bucket sample counts and CIs, held-out speaker splits reported as mean+range, the `SPEAKER_BENCH_REQUIRE_PARITY=1` gate with recorded exit code, and the centroid-growth 1–5 caveat. |
| **P2** Channel delta gate                  | **Survives unchanged — now the single hardest gate**      | It measures the microphone, not the algorithm (`phase-02:14-19`). Every requirement (production `getUserMedia` constraints, DSP-on/off paired, ≥40 turns/speaker/bucket, leave-one-speaker-out worst case, verdict-not-offset, consent before capture, retention date before capture, one-shot) is premise-independent and applies verbatim. **It matters more under the new premise, not less**, because zero-manual has no human correction loop to absorb channel-induced errors.                                                                                            |
| **P3** Attribution authority state machine | **Survives, promoted from supporting to load-bearing**    | Retroactive re-scoring for non-`confirmed` rows and tombstones were "in scope, scoped by authority" (D2). They are now **the mechanism the settle pass writes through** (K14, criterion P4). D2 — _"a human-confirmed chip is never touched"_ — carries over unchanged and is the invariant that keeps the settle pass safe. Add: deterministic total renumbering (criterion P5), which P3 did not contemplate because nothing renumbered.                                                                                                                                      |
| **P4** Enrollment and roster closure       | **Demoted and re-scoped**                                 | Roster closure is a **human act** and is therefore out. Its finding survives as a constraint, not a feature: `phase-04:22-26` correctly reports that acoustics cannot detect a stranger (unmatched-fraction 27.3–36.5 % at 5 % FA, AUC 0.76–0.77; coherence 15.5–25.8 %, AUC 0.72 — re-verified in `session-guest-detection.csv`). D4 flips from _"enrollment must be skippable"_ to _"enrollment is absent by default."_ What survives is the **measurement** of what identity buys, re-aimed at Approach D's one-of-N seeding (M6).                                           |
| **P5** Bounded model screen                | **Unchanged**                                             | Still parallel, still abandonable, still priced out by K12 (0.1 EER points for 3.91× latency). Nothing in the user's decision touches the model axis.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **P6** Ship decision                       | **Amended — its gate is undefined under the new premise** | It gates on `confirmedMatching : corrected ≥ 4:1` and `tap rate ≥ TAP_RATE_FLOOR = 0.5` (`attribution-stats.ts:36`). **A zero-manual product has a tap rate of ≈0 by design**, so both terms divide by zero. Replaced by S1–S5. The `INSUFFICIENT-EVIDENCE` discipline and the "read it from ≥10 real sessions, no analytics" contract survive verbatim.                                                                                                                                                                                                                        |

Dependency graph after amendment: **M1 → restore → (M2, M4) → {M5, M6, M8} → M7 → P2 → P3 → Gate P → Gate S.** P5 stays parallel and abandonable.

---

## 7. Unresolved questions

1. **Is Chatofy commercial?** Decides whether `cc-by-nc-4.0` corpora and NC-licensed weights are usable at all (K18). Blocks any model axis and arguably blocks re-running the bench for a commercial ship decision. **This has been open across two plans and is now blocking.**
2. **Will the user accept a one-time consent for a persisted owner voice template?** This is the difference between Approach D's full value (~20× count-error collapse, if one-of-N behaves like all-of-N) and a session-scoped variant that is warm only after the damage is done. It is a product/privacy call, not a technical one. Both C1 and this question are for the user.
3. **Bounded or unbounded speaker count?** The user wrote "người 1, người 2, ..." — the ellipsis reads as unbounded, but K2 says unbounded is not deliverable cold. Is a stated cap (e.g. "up to 3 people; beyond that, labels go blank") acceptable, or is unbounded a requirement? This changes whether M2's N=5 cell is a gate or a report.
4. **Is post-hoc label churn acceptable, and where?** S3 measures it, but the bar is a judgement call. On-pause renumbering is more useful and more jarring; end-of-session-only is invisible but arrives after the conversation is over. Which does the user prefer?
5. **Is the environment restoration (K8) budgeted?** Gated corpus fetch (GB-scale, licence accepted by a human), model download, cache build. `probe_enrollment_identification.py` is not a cache consumer — it re-embeds raw audio inside its scan loop (`:232`, `:246`), so M6 in that harness is slow. Nothing here is measurable until this happens.
6. **Overlapping speech.** One turn = one speaker is assumed everywhere and there is no speaker-change detector in the repo (K16). In a real two-person conversation people interrupt. Is a known-wrong label on an overlapped turn acceptable, or does it need a detector (out of scope in this contract, non-goal #4)?
7. **What is the true speaker count in a real session, and who records it?** S1 needs ground truth. With no analytics (K17) that is a human writing a number down. Is somebody going to do that for ≥10 sessions?
8. **Does the N=3 enrolment figure survive an RNG audit?** `probe_enrollment_identification.py` shares one `random.Random(args.seed)` across `MEETING_SIZES` and uses `min(MEETING_SIZES)` as an eligibility floor at `:266`, so adding a size changes every other size's meeting composition. Adding N=2 (M6) will therefore **change the published N=3 and N=5 numbers**. Fix the RNG or re-publish all three together — do not quote old N=3 beside new N=2.

---

Status: DONE_WITH_CONCERNS
Summary: Delivered the full contract — outcome, constraints, non-goals, three-gate acceptance criteria, four approaches plus an honest fallback, a recommendation to run bench arms before any product code, and an explicit phase-by-phase fate for the existing plan. All numbers re-verified against the repo; two packet claims were found wrong and corrected.
Concerns/Blockers: (1) The packet's "turn length p50 1163ms" is actually end-to-end latency (`speech-gate.ts:4-6`) — real turn audio duration is unmeasured, and the whole bench scores exactly 2.0s clips (`build_embedding_cache.py:56`), so every cold number is conditional on an untested duration assumption. (2) The existing ship gate (`tap rate ≥ 0.5`, `attribution-stats.ts:36`) is mathematically undefined in a zero-manual product and must be replaced, not relaxed. (3) The inherited `COUNT_ERROR_MAX = 1.0` is too loose for a UI where the labels _are_ the speaker count; I propose tightening to 0.25 and flag that as a bar change requiring the user's assent. (4) Five load-bearing mechanisms (N=2, deferred-mint, one-of-N seeding, offline re-clustering, browser DSP) have zero measurements in this repo, and the bench environment does not exist on this host.
---

# Appendix — ultra verifier ranking

Five candidates, one immutable evidence packet, anonymized before judging.
Winner materialized unchanged above; nothing below was merged into it.

| Candidate      | Faithfulness | Evidence | Criteria | Honesty | Total /80 |
| -------------- | ------------ | -------- | -------- | ------- | --------- |
| A              | 17           | 17       | 19       | 18      | 71        |
| **B (winner)** | **18**       | **18**   | **18**   | **19**  | **73**    |
| C              | 18           | 17       | 17       | 17      | 69        |
| D              | 18           | 18       | 17       | 18      | 71        |
| E              | 17           | 15       | 17       | 15      | 64        |

No candidate failed a hard constraint. Rejection was not warranted.

**Why B won.** It was the only candidate combining a full catch of the evidence
packet's turn-length defect — with the correct mechanism (`build_embedding_cache.py:56`
`TURN_S = 2.0`, and the 1s-vs-2s EER penalty) and the correct remedy (measure real
durations from the already-shipped `audioMs` wire before trusting any bench cell) —
with a zero-error citation record across ~15 spot-checks. Its finding that session
embeddings already accumulate client-side (`turn-keyed-transcript.ts:402-405`, never
evicted) is verified and reshapes the design space: an end-of-session consolidation
pass needs no persistence, no new egress, and no privacy decision. The runner-up got
exactly this point wrong in a load-bearing way. B also dismantles the inherited
`TAP_RATE_FLOOR` ship gate by name (zero denominator in a zero-manual product) and
resolves the Hungarian-remap fork operationally rather than rhetorically.

**Separation: moderate.** B wins by ~2 points over a genuine tie at 71. The ranking
flips on reweighting: to A if raw defect-catch count is weighted over error-free
grounding; to D if the turn-length miss is treated as minor and unique forensic depth
is weighted instead.

## What the choice cost — strongest idea in each non-winner

These are recorded, not merged. They are the strongest candidates for amendments the
user may want to fold in deliberately.

- **A** — two live-code mint triggers the bench never exercises: zero-norm embeddings
  (`embedder.py:106-110`, scores 0.0 against everything, below every calibrated
  `tau_new`) and no minimum-duration floor before `/embed`. Each mints a phantom
  "Người nói N" in production and neither appears in any bench arm. Both are
  unit-testable guards. Plus: a hard cluster cap bounds `|dN|` **arithmetically**
  rather than statistically.
- **C** — the full 24-row cold tally: **4 PASS / 12 FAIL / 8 NO-CONFIG**, every PASS
  on `split == 1`, every FAIL on speaker count alone. Plus the observation that
  `COUNT_ERROR_MAX = 1.0` is **degenerate at N=2** — a total merge of two people into
  one chip scores `|dN| = 1` and passes — fixed with signed error plus exact-count rate.
- **D** — the published 83%→71% cold-decay curve is measured **only at the split-0
  FAIL configuration** (verified by arithmetic: the coldstart rows sum to exactly that
  row's 0.7701/0.9230). So "self-training poisons centroids" is consistent with the
  data but not established by it. Also the only catches of the guest-detection axis
  error and the `MAX_SPEAKERS = 8` collision (`speaker-roster.ts:78`).
- **E** — N=5 NO-CONFIG is not "unmeasured" but a measured catastrophe: loosening the
  calibration target finds configs at `|dN|` 6.03 mean, 15.79 worst, 31.5% accuracy —
  5 people rendered as ~21 clusters (`session-summary-margin08.csv`,
  `session-margin08.log`). Also proved that even the coldstart curve's turn-0 number is
  oracle-remapped (`run_session.py:163`).

**Verifier's own flag:** B misses `MAX_SPEAKERS = 8` (caught by C and D) and the
margin08 artifact (caught by A and E). Both are preserved above precisely so they are
not lost when B is materialized unchanged.

## Evidence-packet defects (controller error, verified after dispatch)

All five candidates received these. Recorded so the numbers above are read correctly.

1. **Turn length.** "p50 1163ms / p95 2983ms" is end-to-end latency
   (`development-journey.md:963`, "Tổng, 32 lượt"), superseded by 859/1849ms at `:996`.
   Per-turn **speech duration is unmeasured anywhere in this repo**.
2. **Guest-detection axis.** `session-guest-detection.csv` has no `enrolled` column;
   0.2725/0.3650 are eres2netv2 vs campplus far-field, not 2 vs 4 enrolled. For the
   shipped model: 36.5% detection at 5% false alarm, AUC 0.7743.
3. **Omission.** `MAX_SPEAKERS = 8` (`speaker-roster.ts:78`, enforced `:96`).
4. **Overstatement.** "N=5 cold NO-CONFIG on all splits" holds for campplus only;
   eres2netv2 far-field finds configs on 2 splits and fails both at `|dN|` 1.69 / 2.50.
5. **Omission.** The margin08 run above.
6. **Stale figure.** Transfer loss: current run is mean +3.5pt / p90 +10.4pt / max
   +17.3pt over 40 calibrations (`session.log`), not the superseded +13.8/48.
