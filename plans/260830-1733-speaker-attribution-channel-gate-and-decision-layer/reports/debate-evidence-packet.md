---
type: evidence-packet
mode: debate
date: 2026-09-01
question: 'Open question 9 — what fills the ~35% of turns the acoustic layer cannot attribute?'
---

# Shared evidence packet — OQ9

**Static text. Passed identically into all three planner prompts. Do not edit
after dispatch.**

Every number is labelled **[measured]** (this repo, this week), **[published]**
(cited), or **[guess]**. Treat unlabelled prose as framing, not fact.

---

## 1. The question

A realtime Vietnamese↔English voice interpreter. One phone, **one microphone
hearing both people**. Each conversational turn gets an anonymous ordinal chip —
"Người 1", "Người 2". No enrolment, no taps, no naming. N=2 is the dominant case;
N=3 happens.

**~35% of turns cannot be attributed by the acoustic layer, at any session
length.** Those turns must nonetheless receive an ordinal, in-session, because
of two binding user decisions (§3).

**The planners' task: propose what fills them.**

---

## 2. What is measured, and how the picture got here

### 2.1 The recorded FAIL was a harness artifact [measured]

`run_session.calibrate` discards any threshold grid point below
`ATTRIBUTION_FLOOR + CALIBRATION_MARGIN = 0.94` **before** the count criterion is
evaluated. Two of the three above-cap policies withhold attribution by design
(`abstain` returns `label=None` at `online.py:263`; `raise_tau` raises the assign
bar at `:247-248`), so a 94% live-attribution floor is structurally unreachable
for them.

Max reachable attribution rate, 105-point grid, 150 calibration meetings/point,
campplus / far-field / N=2 / cold / 1.0s cache:

| above_cap   | max attribution rate | grid points clearing 0.94 |
| ----------- | -------------------- | ------------------------- |
| `assign`    | 0.9953               | **12 / 105**              |
| `abstain`   | 0.8747               | **0 / 105**               |
| `raise_tau` | 0.7927               | **0 / 105**               |

So the recorded `NO-CONFIG` for the two non-default arms said the calibrator
could not grade them — **not** that they attribute badly.

### 2.2 Validity check [measured]

`assign` at floor 0.94 scores prefix-locked **0.5887** on held-out speakers.
The recorded gate cell is 0.569 / 0.627 / 0.570 → mean **0.5887**. Identical.
The diagnostics below therefore sit on the same scale as every recorded number.

### 2.3 Floor sweep, held-out speakers [measured]

Thresholds chosen on calibration speakers only, scored on held-out only, 3
splits, 400 evaluation meetings. Bars at N=2: accuracy ≥ 0.85, exact-count ≥ 0.90.

| policy        | floor    | prefix-locked | attribution rate | exact | shippable |
| ------------- | -------- | ------------- | ---------------- | ----- | --------- |
| assign        | 0.94     | **0.5887**    | 0.980            | 1.000 | 0/3       |
| assign        | 0.65     | 0.8252        | 0.631            | 0.926 | 0/3       |
| **abstain**   | **0.65** | **0.8809**    | 0.597            | 0.942 | **3/3**   |
| **raise_tau** | **0.65** | **0.8731**    | 0.577            | 0.975 | **3/3**   |
| raise_tau     | 0.60     | 0.8706        | 0.554            | 0.981 | 3/3       |

**Caveat that matters:** those accuracies are over **attributed turns only**.
Unattributed turns are excluded from the denominator.

### 2.4 In-session re-scoring — measured and insufficient [measured]

Candidate mechanism: after each turn, re-score every still-pending turn against
the attributor's **current** centroids; commit if it now clears `tau_assign`.
It never merges clusters and never renumbers a committed turn, so it satisfies
Phase 3's monotone merge invariant where the `settle()` pass does not.

`abstain`, floor 0.65, thresholds re-calibrated at each length:

| turns/meeting | immediate | resolved | **unresolved** | acc imm | acc res | exact  |
| ------------- | --------- | -------- | -------------- | ------- | ------- | ------ |
| 10            | 0.5968    | 0.0937   | **0.3096**     | 0.9185  | 0.7336  | 0.9417 |
| 20            | 0.5811    | 0.0680   | **0.3509**     | 0.9379  | 0.7637  | 0.9642 |
| 40            | 0.5881    | 0.0644   | **0.3475**     | 0.9374  | 0.7838  | 0.9742 |

Waits: mean 2.84 / 5.40 / 8.60 turns; p90 6 / 11 / 20; max 8 / 18 / 38.
Resolved within 3 turns: 69.3% / 41.5% / 30.7%.

**The tail does not shrink with session length.** It rises slightly and plateaus
at ~35%. The resolve rate _falls_. Longer sessions make in-session
responsiveness worse, not better.

### 2.5 The honest number under the D8 contract [measured + guess]

With the tail force-assigned (D8 forces coverage to 1.0), overall prefix-locked
accuracy lands **0.77 [tail at 0.50, blind guess] to 0.86 [tail at 0.73, the
measured accuracy of turns the mechanism _could_ resolve]**, against a **0.85**
bar. The upper bracket is not credible: the tail is precisely the residue the
mechanism failed on, so it should be _worse_ than resolved turns, not equal.

### 2.6 Two problems retired [measured]

- **Speaker counting is solved.** Exact-count 0.9417 → 0.9742, improving with
  length, clear of the 0.90 bar. **What fails is labelling, not counting** — the
  opposite of this plan's original framing.
- **Self-reinforcing centroid decay did not appear.** `acc imm` rose with length
  (0.9185 → 0.9379 → 0.9374). The 83%→71% decay recorded elsewhere in this plan
  does not reproduce in this configuration.

### 2.7 Corrections this plan has already had to make

Recorded so planners do not rebuild on retracted claims:

- **C1** — every `online.py` citation in the plan was ~120 lines stale. The claim
  "`K_max` bounds creation, it cannot bound assignment" is **false**; three
  above-cap policies exist and are validated.
- **C2** — "a same-channel imposter pair cannot be constructed" is **false**.
  `build_embedding_cache.py:151-152` applies **one** `RoomConfig()` and **one**
  RIR to every clip, so the far-field arm is already a shared-channel condition.
  Consequence: the far-field duration slope (27.67 → 22.67) is **confounded** by
  that shared RIR, so it is not clean evidence about instrument health.
- **C3** — Phase 8 (moving the embedding `await`) was withdrawn: `embedSpeaker`
  already starts eagerly beside the translation, so there was no latency budget
  to free.
- **The denominator error recurred twice**, once in a red-team finding and once
  in this session's own analysis. Any accuracy quoted over "attributed turns"
  is not comparable to a D8 contract that forces coverage to 1.0.

---

## 3. Binding user decisions — not open for planners to relitigate

| ID      | Decision                                                                                                                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D8**  | **A chip that never resolves to a person is a failure.** Verbatim: _"theo tôi là thất bại"_. Permanent abstention is out. Every turn ends the session carrying an ordinal                |
| **D13** | **A deferred turn must be filled DURING the session.** Waiting until the user presses stop is a failure                                                                                  |
| **D12** | **Fewer wrong labels beats faster labels.** Shown the trade concretely, the user chose ~6 of 10 turns labelled instantly with ~0.7 wrong, over 10 of 10 labelled instantly with ~4 wrong |
| **D10** | Per-turn language ID is **accepted in principle** but was sequenced _after_ this measurement slice: _"làm chắc 1 chiều trước, LID sau"_                                                  |
| **D11** | Fine-tuning on Vietnamese data is **parked, not deleted**                                                                                                                                |
| **D2**  | A human edit is **terminal**. The machine may renumber non-confirmed rows; never a touched one                                                                                           |
| **D3**  | Real meeting size is **2-3 people**                                                                                                                                                      |

The zero-manual premise is the founding requirement: _"tôi không muốn user phải
manual bất cứ chỗ nào, tự động detect, hiển thị người 1, người 2"_.

---

## 4. Research findings

### 4.1 No shipped product solves this, and none exposes an "unknown" state [published]

Checked across Google STT, AWS Transcribe, Deepgram, AssemblyAI, Fireflies:
**every one force-assigns a speaker label.** None documents a shipped real-time
"uncertain/unresolved" per-utterance UX state. Deepgram alone exposes a
`speaker_confidence` float, with **no** documented threshold or UI treatment.

**Granola is the closest architectural analog — one mic, 2 parties — and it
sidesteps the acoustic problem entirely**, using platform-provided per-participant
channels on Meet/Zoom and falling back to a binary "Me"/"Them" split elsewhere.
_(secondary source, moderate confidence)_

**No published system was found for real-time, single-microphone, unenrolled,
2-party attribution.** This problem does not have a shipped precedent.

Captioning convention (DCMP, established accessibility standard) sanctions
generic ordinal labels — "SPEAKER 1" — for unknown identity. That addresses
_naming_ uncertainty, not _turn-assignment_ uncertainty, so it maps only partly.

### 4.2 Turn-taking priors have real quantitative backing [published]

**Turn-to-Diarize** (Google, ICASSP 2022, arXiv 2109.11641): a speaker-turn
detection model injects Must-Link / Cannot-Link constraints into spectral
clustering. On a **2-speaker-only** call-centre subset: DER **14.88% → 8.78%**,
a **41% relative reduction**. Callhome (2 speakers): 46% relative reduction.
Peer-reviewed, standard DER metric, directly on the N=2 case.

**A property specific to this product:** the app **knows exactly when it played
TTS** (`conversation-session.ts:460`, `sounding: () => playback.isPlaying`). The
paper had to _learn_ turn boundaries; here at least some are given.

**Honest limit:** no paper isolates a **pure alternation-only baseline** (no
acoustic model). The 41% is a turn prior _combined with_ acoustic embeddings.

**Conversation structure is a first-order driver** (AWS, arXiv 2106.05792):
turn-taking style causes ΔDER up to **4.99** with voices held constant — larger
than the language-pair effect (≤0.69).

### 4.3 The load-bearing question for D10 has no evidence, and the indirect signal leans against it [published]

The argument for LID has been: _an acoustically ambiguous turn still has a
language, so language is an evidence channel independent of voice timbre._

**No published joint study measures whether LID and speaker-verification errors
are correlated.** Searched specifically; none found.

The closest indirect evidence **argues against independence**:

- Both tasks degrade with duration in the same direction. LID: 0–5s error is
  1.3–1.5× the 5–20s error (TitaNet-LID, arXiv 2210.15781); MuSeLI explicitly
  names 1–5s as the hardest bucket. SV: the same shape.
- Speech-quality literature establishes SNR and duration as predictors of SV
  _unreliability_ — the same signals that would predict LID unreliability.

**The residue here is short, quiet, noisy or reverberant turns — exactly the
regime where both tasks are hardest.** If the two error surfaces coincide, LID
does not rescue the tail; it guesses wrong in the same places.

**This is testable on data already in hand:** run LID on exactly the ~35%
SV-unattributable subset and measure whether it also degrades. No planner should
treat D10 as viable without that check, and no planner should treat it as dead
without it either.

### 4.4 LID practicalities [published]

- **No binary VI/EN accuracy at ~1s exists anywhere published.** Only 107-way
  proxies: TitaNet-LID-3x5x1024 (29M params) 7.5% error in the 0–5s bin;
  SpeechBrain VoxLingua107 ECAPA 6.7% overall. A 2-class task should be easier;
  nobody has published how much.
- **Whisper's 30s padding is real but the sherpa-onnx variant mitigates it.**
  Stock Whisper `pad_or_trim` forces a fixed 30s mel window, so 1s input becomes
  ~97% zero-padding. sherpa-onnx's SLID pads to `min(frames + 1000, 3000)` —
  ~11s for a 1s input by default, configurable. Still off-distribution, but not
  the same defect.
- CPU latency for any of these on ~1s VI/EN clips: **no published number.**
- `langid_ambernet` ships under NGC Terms of Use, **not** a standard OSS licence.
- **Second-order risk, newly surfaced:** language _mismatch_ independently
  degrades speaker verification (Misra & Hansen, SLT 2014). If centroids
  accumulate mixed VI/EN turns from the same person, language variability may be
  adding noise to the embedding space the system already depends on.
- Vietnamese code-switching rate in the target population: **no published
  number**. The nearest corpus (CanVEC) is diaspora heritage speakers, a
  different population.

### 4.5 Fusion mechanics [published]

Log-likelihood-ratio fusion of independent evidence sources is standard and
low-risk to implement. **But no published work fuses a language posterior with a
speaker-similarity score for turn attribution, and no measured gain exists.**
That number would have to be established here.

---

## 5. Constraints

- **C1** CPU-only production (i7-11700K, 4 speech threads shared with STT).
  GPU is rentable but is an ongoing cost on a non-commercial student project.
- **C2** ~200ms for the speaker step; sub-2s end-to-end.
- **C3** The browser cannot reach `/embed`; vectors arrive via
  `server.turn.embedding` after `server.transcript.final`.
- **C4** Every `{vector, audioMs}` already accumulates client-side and never
  evicts — client-side re-processing needs no server call, no persistence, no
  new privacy decision.
- **C5** Privacy contract, shipped: session-scoped, browser-local, nothing
  persisted, no name beside a voice. **The person embedded is usually the
  counterpart, who never touches the product and cannot consent.**
- **C6** `AttributionOrigin` is a compile-time contract — but its "forcing
  function" catches exactly **1 of 9** consumer sites; the other eight compare
  string literals and fail open on a new union member.
- **C8** Non-atomic deploys; any wire change needs the existing per-client opt-in.
- **C13** "One turn = one speaker" is an assumption with no detector behind it.
- **Turn length [measured]**: production p50 **1065ms** of speech; 10 of 21 turns
  under 1.0s; only 5 of 21 reach 2.0s.
- **Evidence base [measured]**: 31 speakers with ≥8 gap-separated clips, 15–16
  evaluated per split, and the three splits are shuffles of the same pool.
- **The far-field condition is synthetic** — one shared RIR (see C2 correction).
  Phase 2, the real-microphone recording, has **never been run** and is one-shot.
- **The instrument audit (P7-M11) has not run.** If trial construction is broken,
  every number above is void.

---

## 6. The option space as currently understood

Not exhaustive — planners may propose others, and should say so if they do.

1. **Turn-taking / conversational prior** — §4.2. Strongest published backing on
   N=2. The app owns hard TTS-playback boundaries the paper had to learn.
2. **Per-turn LID (D10)** — §4.3/4.4. Load-bearing assumption unverified and the
   indirect signal leans against it. Cheap to test on data in hand.
3. **Near/far channel asymmetry** — the device owner is near the mic, the
   counterpart across a table. Orthogonal to voice identity. Untested, and
   `autoGainControl` is _designed_ to erase exactly this cue.
4. **Fine-tune on Vietnamese (D11)** — the only option with a published path
   under the 15% EER KILL line, but it attacks embedding quality, and the tail
   may be a _duration/SNR_ problem rather than a model-quality one.
5. **Force-assign the tail and accept the error** — what every shipped product
   does (§4.1). Cost is unmeasured; at N=2 a blind guess is ~50%.
6. **Lower the bar** — a product decision, not a technical one.

---

## 7. What a good answer must do

- Satisfy **D8** and **D13** as written, or state explicitly and with reasons
  that one of them cannot be satisfied and must go back to the user.
- Name what it does with the residue that survives _its own_ mechanism. Every
  mechanism measured so far has left one.
- State accuracy on the **D8 denominator** (all turns), not over attributed
  turns only.
- Be runnable on CPU inside the latency budget, or price the alternative.
- Say which of its claims are measured, which published, which guessed — and
  name the cheapest experiment that would kill it.
- Respect that **P7-M11 has not run**, so any plan built on the numbers above is
  conditional on the instrument being sound.

---

## 8. Known unknowns

1. Whether LID and SV fail on the same turns. **Testable now.**
2. Binary VI/EN LID accuracy at ~1s. No published number.
3. What fraction of real turns are cross-language. M1 has durations only.
4. Whether the near/far cue survives browser AGC.
5. What a forced assignment on the tail actually scores.
6. Whether the bench instrument is sound (P7-M11).
7. Whether the real channel resembles the clean cell (0.785 prefix-locked) or the
   synthetic far-field cell. Phase 2 decides; it has not run.
