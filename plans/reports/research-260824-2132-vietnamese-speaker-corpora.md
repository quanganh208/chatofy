---
title: 'Research: Vietnamese speaker corpora vs self-recorded fixture'
date: 2026-08-24
type: research
plan: 260824-1900-speaker-attribution-benchmark-gate
---

# Vietnamese speaker corpora — can they replace the Phase 1 fixture?

Triggered by user: "nên research dataset cuộc họp để test". Answer: meeting corpora are the wrong
axis, but the underlying instinct is right — **Checkpoint 1 can run on public Vietnamese data, now,
with no participants, on a far stronger test set than the planned 3-5 person recording.**

## 1. What exists

### Vietnamese speaker-verification corpora (relevant)

|             | Vietnam-Celeb                                  | VoxVietnam                                         |
| ----------- | ---------------------------------------------- | -------------------------------------------------- |
| Speakers    | 1,000                                          | 1,406                                              |
| Utterances  | 87,140                                         | 187,980                                            |
| Hours       | 187                                            | 261                                                |
| Sample rate | 16 kHz                                         | 16 kHz                                             |
| Source      | YouTube + TikTok                               | multi-genre                                        |
| Genres      | interview, podcast, game show, talk show       | spontaneous 207.8h / reading 41.8h / singing 11.9h |
| `<2s`       | 5.8%                                           | 23.56%                                             |
| `2-5s`      | 43.8%                                          | 51.03%                                             |
| Labels      | speaker, **gender, dialect** (N/C/S)           | speaker, genre                                     |
| Trial lists | **official E + H, 55,015 pairs each, 120 spk** | E + H                                              |
| Access      | GitHub -> Google Drive, 4 parts                | HF `hustep-lab/VoxVietnam-Dataset`                 |
| License     | **not stated on repo — must resolve**          | **CC BY 4.0**                                      |

Vietnam-Celeb-H negatives are matched on **both gender and dialect**. That is a genuinely hard
screen, and harder than anything a 3-5 person recording can construct.

### Published EER — this is the load-bearing finding

Vietnam-Celeb paper, ECAPA-TDNN, full-length utterances, no far-field, no browser DSP:

| Training data                     | Vietnam-Celeb-E | Vietnam-Celeb-H |
| --------------------------------- | --------------- | --------------- |
| **VoxCeleb (English) pretrained** | **13.19**       | **16.52**       |
| VLSP 2021 (vi)                    | 11.58           | 14.30           |
| **Vietnam-Celeb (vi)**            | **6.31**        | **8.62**        |
| Vox + Vietnam-Celeb               | 7.33            | 9.37            |

VoxVietnam paper, ECAPA trained on 261h vi: 12.80-14.91 (E) / 21.81-24.14 (H) — harder trial design.

### Meeting / diarization corpora (the literal ask)

**No Vietnamese meeting or diarization corpus with RTTM exists.** Searched; nothing found. What
exists is other-language: AMI (en), AliMeeting + AISHELL-4 (zh, far-field arrays), MSDWild
(multilingual in-the-wild, language inventory unpublished), M3SD, VoxConverse, DIHARD, CHiME-6.

They would give real turn dynamics in the wrong language. Since the thing under test is a
**language-sensitive embedding**, wrong-language turn dynamics buys little — and Phase 4's
"simulated session" already synthesises sessions from labelled utterances, which is the same
structure without the language mismatch.

## 2. What this means for the gate

**Checkpoint 1's threshold is already in doubt, before we measure anything.**

The gate is EER <= 10% at the far-field 2s bucket. A VoxCeleb-pretrained model scores **13.19% on
Vietnamese at full length, clean channel**. Our `wespeaker_en` baseline is exactly that class of
model. Truncating to 2s and adding far-field only moves it up. So the English baseline is very
likely dead already — consistent with the bench's own Mandarin smoke test, where `wespeaker_en`
failed to separate speakers that both 3D-Speaker models separated cleanly.

This also settles the advisory disagreement recorded in the brainstorm: **VoxCeleb-trained models do
not transfer well to Vietnamese.** There is now a published number, not two opinions.

`campplus` and `eres2netv2` are Mandarin-trained; no published Vietnamese number exists for either.
Mandarin is tonal like Vietnamese, so transfer _may_ beat VoxCeleb's — that is a hypothesis, and it
is exactly the measurement worth buying.

**A Vietnamese-trained model reaches 6.31 / 8.62.** So the <=10% bar is achievable in principle for
Vietnamese, at full utterance length. Fine-tuning is out of scope for this gate but is a live
remediation lever if the off-the-shelf candidates miss.

## 3. What the corpora cannot replace

- **The browser DSP channel.** `echoCancellation` + `noiseSuppression` + `autoGainControl`, all
  enabled at `apps/web/src/hooks/use-streaming-translate.ts:109-117`. No corpus has it. This was
  Phase 1's highest-rated risk and it stays real.
- **True far-field at a known distance.** Corpus audio is broadcast-processed, mixed-channel, not
  systematically 2m. Approximable by RIR convolution + MUSAN noise — the standard method, and the
  one both papers used for their own augmentation.
- **Our exact turn cut.** Approximable by truncating corpus utterances to the 1s/2s/3s buckets and
  segmenting through `segment.py`.

So corpus data makes Checkpoint 1 **necessary-but-not-sufficient** — which is the role Checkpoint 1
already had in the plan. Nothing about the gate's logic has to change.

## 4. Recommendation — restructure, do not just add

Front-load the kill decision onto data that exists today, and spend participants' time only if the
feature survives it.

1. **Phase 1 becomes corpus acquisition.** Fetch VoxVietnam (CC BY 4.0, clean license) and
   Vietnam-Celeb (for its E/H trial lists and the published baseline our number is comparable to).
   Days of work, zero scheduling. Resolve Vietnam-Celeb's license before relying on it.
2. **Phase 3 (Checkpoint 1) runs on Vietnam-Celeb-H**, truncated into 1s/2s/3s buckets, clean and
   RIR+noise augmented. 120 speakers x 55k pairs decides the model — not 3-5 people.
3. **Self-recording shrinks to a channel-delta measurement**, and only if Checkpoint 1 passes:
   how far does the browser DSP move the EER measured on corpus data? Much smaller session, and if
   the gate kills the feature, nobody is ever recorded.
4. **Phase 4 synthesises sessions from held-out Vietnam-Celeb speakers** — already what "simulated
   session" meant.

Cost of being wrong here is low and the ordering is strictly better: the expensive, calendar-bound,
privacy-laden step moves behind the cheap decisive one.

## Unresolved questions

- Vietnam-Celeb license is unstated on its repo. Acceptable for a graduation project? Blocking for
  publication? Needs the user's call, or an email to the authors.
- Keep the browser-DSP self-recording as a **gate input** or demote it to **diagnostic**? Demoting
  is what makes the reordering pay off; it also means the shipped thresholds are calibrated on a
  channel that is not production's.
- Simulate far-field by RIR, or insist on real 2m recordings? RIR is standard and cheap; real is
  truthful. Current recommendation: RIR for the screen, real for the delta check.
