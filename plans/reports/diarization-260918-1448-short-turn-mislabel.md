# Short turns mint a phantom speaker

Read-only diagnosis. No source file was modified.

## Verdict

The hypothesis is **confirmed, with a correction to its wording and one addition**. The
speaker embedding is computed on too little _speech_, the vector carries no speaker
information, and it falls below `tauNew` — but the wrong label on four of the five turns is
not that first failure. It is a **phantom cluster**: turn 4 minted "Speaker 2" out of noise,
and turns 10, 11, 12 and 38 then joined it _confidently_, because low-information vectors
resemble each other far more than they resemble a real voice centroid.

I reproduced the production labelling exactly — all 55 turns, 0 mismatches, phantom at
positions 4, 10, 11, 12 and 38 and nowhere else — by cutting each turn out of `rec.wav`,
embedding it on the live sidecar, and replaying `observeVoice` in Python.

The measured floor is **1250 ms of speech**. Two independent measurements land on it.

**The addition, from the cross-conversation table:** there is a _second_ failure mode with
the same root cause and a worse consequence, on a different code path. `observeVoice` mints
its first cluster **with no threshold consulted at all**
(`auto-attribution.ts:204-209`), so when a conversation opens on a short turn, that turn
becomes Speaker 1 whatever it contains, and the human who speaks the rest of the
conversation is minted second. Two production conversations show exactly this.

## 1. Where the decision is made

**Entirely in the browser.** The sidecar decides nothing: `services/local-stt/app.py:103`
accepts audio and returns a unit-norm vector, and `services/local-stt/speaker/embedder.py:91`
normalises it. There is no threshold, no comparison and no notion of a speaker anywhere on
the server.

The decision is `observeVoice` at `packages/realtime-client/src/state/auto-attribution.ts:192`.
**Creating and claiming are separate decisions, and there are four exits, not two** — this
matters for the fix, so all four:

| line                      | test                               | outcome                                                 |
| ------------------------- | ---------------------------------- | ------------------------------------------------------- |
| `auto-attribution.ts:204` | `clusters.length === 0`            | **create — no threshold consulted, `score: -Infinity`** |
| `auto-attribution.ts:238` | `bestScore >= tauAssign`           | claim that voice                                        |
| `auto-attribution.ts:241` | `bestScore < tauNew`, under `kMax` | **create**                                              |
| `auto-attribution.ts:256` | `bestScore < tauNew`, at `kMax`    | claim nearest                                           |
| `auto-attribution.ts:261` | between the bars                   | `pending`, filled at settle                             |

The constants are `DEFAULT_AUTO_ATTRIBUTION` at `auto-attribution.ts:69-79`:
**`tauAssign: 0.375`, `tauNew: 0.325`, `kMax: 2`**. The reducer calls it at
`packages/realtime-client/src/state/turn-keyed-transcript.ts:625` and mints the roster entry
at `turn-keyed-transcript.ts:645-654`.

The first row of that table is the one nobody was looking at. Every other exit weighs a
cosine against a bar; that one weighs nothing. The first vector of every conversation
becomes Speaker 1 unconditionally.

## 2. Is there a minimum-duration or minimum-energy guard?

**No. Not anywhere on the path, in either unit, at any layer.** Stated plainly because it
is the whole defect:

- `services/local-stt/audio/decode.py:25` defines `MAX_AUDIO_SECONDS` only. There is no
  minimum; the file has no lower bound of any kind.
- `app.py:103-131` inherits that cap and adds nothing. Its own comment says the cap is
  "inherited deliberately"; nobody considered the other end.
- `embedder.py:91` embeds whatever samples it is handed. Its only length-related branch is
  a zero-norm check for digital silence, which near-silence does not trigger.
- `apps/api/src/modules/translate/services/pipeline-translator.service.ts:161` calls
  `/embed` unconditionally, and
  `apps/api/src/modules/translate/services/translation-session.service.ts:324` gates only on
  the feature flag and the per-session option.
- `turn-keyed-transcript.ts:588` stores `audioMs` and then never reads it. The field exists,
  reaches the reducer, and is used for nothing but weighting in the retired enrolment path
  (`speaker-centroids.ts:67`).

## 3. Measurements

Sidecar: live `campplus` extractor on `localhost:8012`, `dim=192`. Speaker-1 centroid is the
normalised sum of ten 3-second clips from unambiguous long turns.

### The five turns, cut as production cut them

Clip = detected speech span, extended by the client's 320 ms pre-roll and 500 ms hangover,
clipped at the neighbouring turn's speech onset.

| pos | text | speech  | buffer  | cos → Speaker-1 centroid | verdict                      |
| --- | ---- | ------- | ------- | ------------------------ | ---------------------------- |
| 4   | Đây  | 1060 ms | 1050 ms | **−0.010**               | below `tauNew` → NEW SPEAKER |
| 10  | Vâng | 720 ms  | 1540 ms | **0.297**                | below `tauNew`               |
| 11  | Đây  | 270 ms  | 1090 ms | **0.057**                | below `tauNew`               |
| 12  | Hè   | 360 ms  | 1180 ms | **0.260**                | below `tauNew`               |
| 38  | Đấy  | 1220 ms | 1300 ms | **0.315**                | below `tauNew`               |

Every long Speaker-1 turn, by contrast, scores 0.61–0.90 against the same centroid, and
leave-one-out over the ten references gives 0.52–0.87. The gap is not marginal.

### The vectors are noise, not a different voice

Three controls rule out "these really are acoustically distinct":

**The same word, the same person, three times.** "Đấy" at position 29 (Speaker 1, 710 ms),
position 35 (Speaker 1, 700 ms) and position 38 (labelled Speaker 2, 1220 ms) score
**0.102, 0.210 and 0.212** against each other. Identical phonetic content from one human
produces vectors that are nearly orthogonal.

**One sentence chopped into 300 ms pieces.** Position 21, a single continuous Speaker-1
utterance, cut into 14 consecutive 300 ms chunks: pairwise cosine among them averages
**0.234** (min −0.060), and **73%** of pairs fall below `tauNew`. Against the speaker's own
centroid, **29% of the chunks would mint a new speaker**. Nothing about those chunks differs
except length.

**Short is not automatically fatal.** Positions 52 (430 ms) and 29 (710 ms) score 0.437 and
0.530 and were labelled correctly. Below ~1 s the outcome is a coin flip, not a constant —
which is exactly why a threshold is needed rather than a fix to the audio.

### Length sweep

Windows cut from long Speaker-1 utterances, scored against a centroid built from the _other_
nine turns (held out, so no self-contamination). 80 windows per length.

| clip length | mean  | min    | p5    | mints a false new speaker (`<0.325`) |
| ----------- | ----- | ------ | ----- | ------------------------------------ |
| 0.10 s      | 0.144 | −0.071 | —     | **93.3%**                            |
| 0.25 s      | 0.281 | −0.014 | —     | **60.0%**                            |
| 0.50 s      | 0.455 | 0.012  | 0.233 | **15.0%**                            |
| 0.60 s      | 0.501 | 0.063  | 0.327 | 5.0%                                 |
| 0.75 s      | 0.550 | 0.023  | 0.333 | 3.8%                                 |
| 0.90 s      | 0.571 | 0.001  | 0.262 | 6.2%                                 |
| 1.00 s      | 0.603 | 0.281  | 0.295 | 6.2%                                 |
| **1.25 s**  | 0.660 | 0.358  | 0.464 | **0%**                               |
| 1.50 s      | 0.687 | 0.339  | 0.429 | **0%**                               |
| 1.75 s      | 0.725 | 0.477  | 0.563 | **0%**                               |

The mean rises smoothly from 0.1 s, but the **tail** is what mints speakers, and the tail
does not clear `tauNew` until **1.25 s**. At 1.0 s the mean looks healthy at 0.603 while
6.2% of clips still fall below the bar — a mean-based reading of this table would have
picked 1.0 s and left the bug in.

### End-to-end replay

All 55 turns cut from `rec.wav`, embedded, and run through a faithful port of `observeVoice`
with the shipped constants:

- **55 of 55 labels match production. 0 mismatches.** Phantom Speaker 2 at exactly
  4, 10, 11, 12, 38.
- Turn 4 scored **0.277** against Speaker 1 — below `tauNew` — and minted the phantom.
- Turns 10, 11, 12 and 38 then scored **0.478, 0.767, 0.441, 0.647** against the _phantom_,
  all at or above `tauAssign`, while scoring 0.289, 0.050, 0.090, 0.292 against the real
  Speaker 1. They did not fall into the phantom; they were **pulled** into it.
- `kMax: 2` guaranteed the damage stayed on one wrong chip rather than spreading, and
  guaranteed it could never self-correct.

Replaying with a guard applied:

| guard                | clusters minted | turns on phantom | suppressed |
| -------------------- | --------------- | ---------------- | ---------- |
| none                 | 2               | 5                | 0          |
| speech ≥ 750 ms      | 2               | 2 (pos 4, 38)    | 5          |
| speech ≥ 1000 ms     | 2               | 2 (pos 4, 38)    | 5          |
| **speech ≥ 1250 ms** | **1**           | **0**            | 7          |

The replay and the sweep were derived independently and agree on 1250 ms.

## 4. The same defect in three other conversations

From the cross-conversation query, verified against prod Postgres. **`offsetMs` is NULL for
10 of the 12 stored conversations** — only the two most recent carry it, and no conversation
stores audio or duration. For the three below I therefore have word counts and ordering, and
nothing else. Word count is a proxy, and section 6 bounds how good a proxy it is.

**A short _first_ turn corrupts the naming order — a second, worse failure mode.**

`cmtz7fa6w` opens with position 0 = "Oh yeah, the" (3 words), labelled **Speaker 1**. All
sixteen remaining turns — 5 to 64 words, averaging 34.9 — are **Speaker 2**. `cmtzy8fob` is
the same shape: position 0 = "You need." (2 words) as Speaker 1, then all five real turns as
Speaker 2.

That is `auto-attribution.ts:204-209` doing exactly what it is written to do. The first
vector mints cluster 0 with no bar; the first genuine turn then scores below `tauNew`
against that garbage centroid and mints cluster 1. The human who speaks the whole
conversation is named second, for the whole conversation. Suppressing _attribution_ on short
turns does not touch this — the turn has to be prevented from **creating**, which is a
separate exit in the code and needs to be blocked as such.

`cmu4edytm` is the conversation I analysed above, and it avoided this only by accident:
its position 0 is "Hello anh em" at 1680 ms of speech, long enough to seed a good centroid,
so the phantom was minted second rather than first.

`cmtz8jtb9` is the genuine two-speaker conversation and section 5 is about it.

## 5. The guard leaves the one real positive untouched

`cmtz8jtb9` is the only true multi-speaker conversation in the data, and it is the
regression case. In turn order:

- Positions 0–4 are Speaker 1 at **21, 40, 11, 43 and 49 words**. Position 0 seeds cluster 0
  from a substantial turn.
- **Position 5 — the turn that creates Speaker 2 — is 12 words** ("Welcome guys, today we
  are learning beginner Engli…"). It is a real utterance, not a filler.
- The only two turns at or below 2 words are position 7 ("And let's") and position 28
  ("And the"), both already labelled Speaker 2.

So the guard does not merely leave this conversation's speaker _count_ intact — it leaves
**every label identical**:

- Position 5 passes the floor by a wide margin, so Speaker 2 is still created, at the same
  position, in the same order. The roster numbering is unchanged.
- Positions 7 and 28 are suppressed and fall to carry-forward, which inherits from positions
  6 and 27 respectively — **both Speaker 2, which is what they already read**.

Every other turn in the conversation is 3 words or more. This is the strongest statement the
data supports: on the one conversation where the feature works, the fix is a no-op.

## 6. What a word count implies about duration

Since no conversation stores duration, the claim in section 5 rests on 12 words being
comfortably above a 1250 ms floor. From the 55 turns of `cmu4edytm`, where I have both the
stored text and the measured speech span:

- Median **309 ms per word**; at the **10th percentile, 199 ms per word** (fastest decile).
- **Every turn below the 1250 ms floor is 1 or 2 words** — all seven of them. Conversely the
  shortest 3-word turn measures 1290 ms.
- At the p10 rate, 12 words implies **≈2384 ms** of speech. For a 12-word turn to fall under
  1250 ms it would have to be spoken at 104 ms per word — half the fastest rate observed
  across 55 turns, and beyond plausible articulation for connected speech.

One caveat in the right direction: that rate is Vietnamese, whose words are largely
monosyllables, while `cmtz8jtb9` is English. English averages more phonemes per word, so its
ms-per-word is if anything higher and the margin wider.

## 7. Fix options

### Where the guard goes

A guard placed in the reducer **before `observeVoice` is called**
(`turn-keyed-transcript.ts:625`) covers all four exits in section 1 at once, because
`observeVoice` is simply never reached — including the unthresholded first-vector mint at
`auto-attribution.ts:204` that section 4 is about. A guard placed _inside_ `observeVoice`,
or on the sidecar, would have to handle each exit separately. This is the main argument for
the placement below.

### Should creating and claiming get different floors?

The lead's point, and I tested it rather than reasoning about it. Three variants, replayed
over all 55 turns at a 1250 ms floor:

| variant                                             | clusters | on phantom | pending | centroid vs clean reference |
| --------------------------------------------------- | -------- | ---------- | ------- | --------------------------- |
| block both create and claim                         | 1        | 0          | 7       | **0.9974**                  |
| block create only, short turns join and fold        | 1        | 0          | 0       | 0.9902                      |
| block create only, short turns join without folding | 1        | 0          | 0       | **0.9974**                  |

All three fix this conversation, and "block create only, no fold" looks attractive: identical
labels, no pending chips, no centroid damage. **I would still block both**, because this
conversation cannot show the cost. With two real voices established, a short turn joining its
nearest is placed by a vector that carries no speaker information — `auto-attribution.ts:136-142`
already records that this scores 0.51–0.53 against a chance level of 0.50 at two speakers.
Letting it claim is a coin flip; carry-forward at least bets on conversational continuity,
which is the bet `fillPendingTurns` was written to make. Blocking creation alone fixes the
conversations in hand and leaves a 50/50 label on every short turn of every genuine
two-speaker conversation.

So: one floor, applied to both decisions, enforced before `observeVoice`.

### A required second change, or the fix introduces the design's named failure

`turn-keyed-transcript.ts:691` returns early when `clusters.length === 0`, and its comment
states the premise: _"`observeVoice` mints a cluster from the very first vector it is given,
so an empty cluster list means the acoustic layer never ran at all."_ **The guard falsifies
that premise.** Once short turns can be withheld, an empty cluster list also means "every
turn was too short" — and then the `pending` rows written for them are never filled, which
is precisely the outcome `speaker-roster.ts:30-43` names as the design's one failure.

`cmtzy8fob` is the real instance: six turns of 2–5 words, all of which a 1250 ms floor would
plausibly suppress. Today it renders two speakers; with the guard and without this second
change it would render six chips that never resolve.

The discriminator is available and cheap: `state.embeddings` is empty when the layer never
ran, and non-empty when it ran and placed nothing. The settle case should branch on that
rather than on the cluster count.

### The recommendation

The sidecar measures voiced duration from the samples it has already decoded and returns it
beside the vector; `translation-session.service.ts:381` forwards it on
`server.turn.embedding` as `speechMs`; the reducer guards on it at
`turn-keyed-transcript.ts:625`, before `observeVoice`: store the embedding, `markPending`,
and skip the turn in the settle `fill` at `turn-keyed-transcript.ts:701` so it carries
forward. Plus the settle discriminator above.

The decision stays where it already is and where `pending` is expressible, and the threshold
is expressed in the unit it was measured in.

**Constant: 1250 ms of speech.** From the sweep, where the share of same-speaker clips
falling below `tauNew` first reaches 0% (0/80 at 1.25 s, 1.50 s and 1.75 s; 6.2% at 1.00 s),
and independently from the replay, where the phantom disappears at exactly that floor and
survives 1000 ms.

**The smaller fallback** is a reducer-only guard on the existing `audioMs` at ~1700 ms, with
no protocol change. It suppresses the same seven turns here, but `audioMs` is buffer time —
it counts pre-roll, hangover and leading silence as speech. Position 10, with 720 ms of
speech in a 1540 ms buffer, is where the two units diverge, and its constant would be a
conversion from my measurement rather than the measurement itself, depending on
`PRE_ROLL_MS` (`capture-pump.ts:22`) and `SPEECH_HANGOVER_MS` (`speech-gate.ts:29`) holding
still.

**Cost, stated rather than buried.** Seven of 55 turns here would go `pending` and resolve by
carry-forward at settle instead of being named immediately; all seven are correct under
carry-forward, because there is one speaker. The real trade is a genuine second speaker whose
_first_ turn is a short interjection: the guard makes that turn inherit the wrong name rather
than mint the right one. That is the same trade the design already makes at
`auto-attribution.ts:253-256` when `kMax` forbids a new voice, and it fails in the direction
the design prefers — a chip that resolves, and reads.

### Specs that would change

- `packages/realtime-client/src/state/auto-attribution.spec.ts:76` — its `embedding()` helper
  defaults to `audioMs = 1000`, under any of the floors above. Every clustering test in that
  file would start suppressing its own turns. The helper must carry a passing duration, and
  the file needs new cases for the suppression path and for the blocked first-vector mint.
- `packages/realtime-client/src/state/speaker-centroids.spec.ts:53` — defaults to
  `audioMs = 2000`, so it survives the fallback but needs `speechMs` added under the
  recommendation.
- `packages/realtime-client/src/state/turn-keyed-transcript.spec.ts` — needs the settle case
  where embeddings were received but no cluster was ever minted.
- `apps/api/src/modules/translate/services/translation-session.service.spec.ts:2154` —
  asserts `audioMs > 0`; should assert the new field too.
- Event shape in `apps/api/src/modules/translate/session/turn-session.ts` and its type in
  `@chatofy/types`, plus `services/local-stt/test_embed.py` for the new response field.

## Recurrence prevention

The gap is not that a threshold was wrong — `tauAssign` and `tauNew` behave exactly as
calibrated, on clips of the length they were calibrated at. Two gaps produced this:

**Nothing records how much speech a vector was computed from.** A vector built on 270 ms and
one built on 6 s are indistinguishable by the time the decision is made. `audioMs` is
carried, reaches the reducer, and is read by nothing on the live path.

**One exit had no bar, and nothing would have told anyone.** `auto-attribution.ts:204` mints
the first cluster unconditionally, which is invisible in every test that starts a
conversation with a normal turn — and every existing test does. The conversations where it
bites are the ones that open on a cough.

Worth a counter as well: `attribution-stats.ts` already derives everything from rendered
state. A voice whose entire membership is short turns is a detectable shape, and this
conversation is the canonical instance — the phantom's five turns total under 4 s of speech
against 48 turns totalling four and a half minutes. `cmtz7fa6w` is the same shape with one
turn and 3 words.

## Unresolved questions

1. Would a 1250 ms floor actually have suppressed `cmtz7fa6w` position 0? It is 3 words of
   English, and my own data puts the shortest 3-word turn at 1290 ms — right on the line. The
   audio is not stored, so this is the one case in the table I cannot settle. It does not
   change the recommendation, since the fix blocks creation on the same floor either way, but
   it means I cannot promise that conversation would have come out right.
2. Should the guard also refuse a turn whose _energy_ is abnormal rather than only its
   length? Position 12 peaks at −10.5 dB against a −20 to −25 dB norm for this speaker,
   suggesting clipping, but one sample is not a measurement and I did not sweep it.
3. `kMax: 2` means one phantom consumes the entire roster budget, so a real second speaker
   arriving later can never be minted. Acceptable once the guard lands, or should a cluster
   whose whole membership is below the floor be reclaimable at settle?
4. My turn boundaries are reconstructed from the recording's energy envelope, calibrated
   against a measured 350–410 ms lag between speech onset and the stored `offsetMs`. The
   replay matching 55 of 55 is strong evidence the reconstruction is faithful, but the true
   `audioMs` values production sent are not stored — `ConversationTurn` has no duration
   column — so speech duration is a measurement and buffer duration is a reconstruction.
5. The 1250 ms floor is measured on one speaker, one channel, one language. The regression
   argument for `cmtz8jtb9` rests on a word-count proxy calibrated on Vietnamese and applied
   to English. A second real two-speaker recording, with audio kept, would close both.

## 8. The price of the guard in genuine dialogue

`cmtz8jtb9` has no stored recording, so `speechMs` cannot be measured for it. The bound
below uses **word count as a proxy** — a 2-word row is almost certainly under 1250 ms of
voiced speech, an 11-word row almost certainly over it, and 3–4 words is the band where I
cannot tell (section 6: the shortest 3-word turn I measured is 1290 ms, right on the line).

### Which rows the guard touches

| conversation          | rows | ≤2 words (under) | 3–4 words (borderline) | ≥5 words (over)  |
| --------------------- | ---- | ---------------- | ---------------------- | ---------------- |
| `cmtz8jtb9` Speaker 1 | 8    | 0                | 0                      | 8 (min 11 words) |
| `cmtz8jtb9` Speaker 2 | 21   | 2                | 1                      | 18 (min 5 words) |

Three rows of 29 are at or near the floor: positions 7 ("And let's", 2 words), 26 ("There's
lasagna here", 3 words) and 28 ("And the", 2 words).

### The carry-forward failure, and how often it fires here

The failure is real and worth naming precisely: a guarded turn carries forward the previous
speaker at `speaker-roster.ts:390`, so if B says a short "vâng" while A has been talking,
the turn is attributed to **A** — the wrong human, silently, under a chip that looks as
confident as any other. The chip reads `suggested`, exactly like a turn the acoustic layer
actually placed.

**In `cmtz8jtb9` that fires zero times.** All three sub-floor rows are preceded by a row
carrying the same label (positions 6, 25 and 27, all Speaker 2), so carry-forward reproduces
the label they already have. The price of the fix on the only genuine dialogue in the corpus
is **0 of 29 rows changed** — against the 7-of-55 suppression figure on the single-speaker
conversation, where all 7 also come out correct.

**In `cmtzy8fob` one row sits in the dangerous position** — position 1 ("U-shirt gpt",
2 words) follows position 0, which is labelled Speaker 1. But that count is measured against
a corrupted baseline: Speaker 1 there _is_ the spurious cluster from the unthresholded first
mint (section 4). Under the fix, position 0 is suppressed, no cluster is ever created, and
the conversation becomes the settle-discriminator case in section 7 rather than a
carry-forward miss. It should not be counted as a cost of the guard.

So across both conversations the guard produces **no wrong attribution that the current code
does not already produce.**

### Does the roster survive?

Yes, and from the code path rather than intuition. Speaker 2 is created only at
`auto-attribution.ts:241` (`bestScore < tauNew` while `clusters.length < kMax`). With the
guard, the candidate set for that exit is just the turns above the floor — and in
`cmtz8jtb9` that is 18 of Speaker 2's 21 rows, the earliest being position 5 at 12 words,
which is the row that creates the cluster today. Speaker 1's side is anchored by 8 rows of
11+ words. Neither speaker depends on a short turn for its existence.

**A genuine two-speaker conversation collapses to one only if** every one of the second
speaker's above-floor turns scores at or above `tauNew` against the first speaker's centroid.
Two ways that happens: the second speaker never produces a single turn longer than the floor
— they only ever interject — or their voice genuinely sits within 0.325 of the first
speaker's centroid at full length, which is the pre-existing accuracy limit of the feature
and not something the guard introduces. The first is the one to watch: a conversation where
one participant only ever says "yeah" and "mhm" now discovers one speaker instead of two.
That is a real regression in a real shape of conversation, and it is the strongest argument
against the guard I can construct from this data.

### Leaving the turn unattributed instead

Available, and it changes less than it appears. `isRendered` (`speaker-roster.ts:250`) is
already false for both `pending` and `fallback`, so the grouping split at
`display-groups.ts:119` fails to fire either way — choosing unattributed over carry-forward
introduces **no new wrong-merge**, because the unrendered state already has that property the
moment the guard exists.

There is a wrong-merge window, but the guard opens it and neither choice closes it: a long
turn cut at the ceiling (`cutForced`, `display-groups.ts:89`) followed within 1200 ms by a
guarded short turn will merge, putting that turn inside the previous speaker's block. It is
**live-only** — at settle the turn is written `suggested` (`speaker-roster.ts:397`),
`isRendered` becomes true, and the split fires on re-render.

Since the carry-forward miss count is 0 on the one genuine dialogue, the risk is not
material and I would keep carry-forward. Its cost is a wrong name that reads confidently;
unattributed's cost is a turn that renders as nobody for the length of the conversation and
gives up the one thing `pending` promises. Carry-forward is also already the design's chosen
bet in this exact situation (`speaker-roster.ts:342-350`), stated there as a bet.

```
Status: DONE
Summary: Confirmed and proved the hypothesis — short turns produce speaker vectors carrying no speaker information; turn 4 minted a phantom "Speaker 2" at cosine 0.277 and turns 10/11/12/38 were pulled into it at 0.44-0.77, and a replay of the real clusterer over all 55 turns reproduces production exactly, 0 mismatches. The cross-conversation table exposed a second failure mode on a different exit: `observeVoice` mints its FIRST cluster with no threshold at all, so a conversation opening on a short turn names the real speaker second. Measured floor is 1250 ms of speech, agreed independently by the length sweep and the replay, and verified to leave the one genuine two-speaker conversation's labels completely unchanged.
Regression case closed: on cmtz8jtb9, the only genuine dialogue in the corpus, 3 of 29 rows sit at or near the floor and all 3 are preceded by a row carrying the same label, so carry-forward changes 0 labels; both speakers keep large above-floor populations (8 of 8 and 18 of 21 rows at 5+ words), so the roster is anchored and cannot collapse.
Concerns/Blockers: The fix as scoped needs a second change or it introduces the design's named failure — `turn-keyed-transcript.ts:691` treats an empty cluster list as "the layer never ran", which stops being true once turns can be withheld, leaving `pending` chips that never resolve (cmtzy8fob is the live instance). The guard introduces one real regression shape it cannot avoid: a participant who only ever interjects, never producing a turn above the floor, is no longer discovered as a second speaker. No conversation stores audio or duration and `offsetMs` is NULL in 10 of 12, so the cross-conversation evidence rests on a word-count proxy; whether a 1250 ms floor would have caught cmtz7fa6w's 3-word first turn cannot be settled from stored data.
```
