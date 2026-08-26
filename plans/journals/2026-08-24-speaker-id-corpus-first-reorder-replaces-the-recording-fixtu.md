---
title: 'Speaker-id: corpus-first reorder replaces the recording fixture'
date: 2026-08-24
summary: Research found public Vietnamese speaker corpora with official trial lists. Checkpoint 1 no longer needs participants; the recording demoted to a channel-delta diagnostic. Built trials.py + fetch_corpora.py.
---

# Speaker-id: corpus-first reorder replaces the recording fixture

Research found public Vietnamese speaker corpora with official trial lists. Checkpoint 1 no longer needs participants; the recording demoted to a channel-delta diagnostic. Built trials.py + fetch_corpora.py.

## What changed

The user asked to research meeting datasets. Meeting corpora turned out to be the wrong axis — no
Vietnamese meeting/diarization corpus with RTTM exists, and wrong-language turn dynamics buys little
when the thing under test is a language-sensitive embedding. But the instinct was right for a
different reason: public Vietnamese **speaker-verification** corpora exist, with official trial
lists.

So Phase 1 stopped being a 3-5 person recording session and became corpus acquisition. The recording
became Phase 7, demoted from gate input to channel-delta diagnostic, and gated on Checkpoint 1
passing. The consequence worth stating plainly: **if the gate kills the feature, nobody is ever
recorded.** The expensive, calendar-bound, privacy-laden step now sits behind the cheap decisive one.

The screen also got stronger, not just cheaper: 120 test speakers and ~55k gender-and-dialect-matched
pairs, against the few hundred pairs a small session could construct under the time/position rules.

## The number that reframes the gate

Vietnam-Celeb's paper reports ECAPA-TDNN EER on its own lists, at full utterance length and clean
channel: **VoxCeleb-pretrained 13.19 (E) / 16.52 (H)**, Vietnamese-trained 6.31 / 8.62.

Checkpoint 1's bar is EER <= 10% at the 2s far-field bucket. So the `wespeaker_en` baseline is
already above the bar under conditions easier than ours, before truncation or far-field. That also
settles the advisory disagreement recorded in the brainstorm about whether VoxCeleb models transfer
to Vietnamese — with a published number rather than two opinions. It matches the bench's own Mandarin
smoke test, where that model failed to separate speakers the two 3D-Speaker models separated cleanly.

Recorded the inverse guard too: a candidate scoring far better than 6.31 at 2s should be treated as a
bug, not a triumph.

## Two corrections during implementation

**The trial lists are not in the GitHub repo.** I planned `fetch_corpora.py` around fetching
`vietnam-celeb-e/h.txt` as plain text. The repo holds only a README pointing at four Google Drive
parts; the lists live inside that archive. The script now verifies a user-performed extraction and
names the missing files, instead of pretending to download. Its absence is deliberately NOT a
non-zero exit — VoxVietnam alone runs the screen, and failing on it would train the reader to ignore
the same exit code that reports a real failure.

**The licence is `cc-by-nc-4.0`, not CC BY 4.0.** The paper's HTML said the latter; HF metadata says
the former, and metadata wins. VoxVietnam is also `gated: auto`. The script therefore reads a token
from the environment and refuses with instructions when there is none — accepting a dataset's
conditions is the user's act, and a script that worked around the gate would make that decision
silently and leave no trace.

## A real bug the tests caught

`compute_eer`'s first implementation swept thresholds **per sample**, which treats tied scores as
orderable. On fully-tied input it returned 100% EER instead of 50%. That is not only a degenerate
case: quantised cosines tie often enough that the error shows up in real data, and it is optimistic —
it credits the sweep with separation the scores do not contain.

Caught because the test compares against an ANALYTIC value — for two unit-variance Gaussians
separated by d, EER is exactly Phi(-d/2) — plus degenerate cases the analytic test cannot reach. A
subtly wrong sweep still returns a believable percentage, and Checkpoint 1 would have read a gate
decision off it. Fixed by evaluating each threshold by value via `searchsorted`.

Mutation testing: 8 mutants, 5 killed, 3 survived — and all three survivors are provably equivalent
(`unique` vs `sort` is a speed optimisation once thresholds are evaluated by value; `>= 0` vs `> 0`
lands on the same crossing; interpolating `far` vs `frr` is identical at the point where the weight
is chosen to make them equal). Chasing them would have meant writing tests that assert an
implementation rather than a behaviour. It did expose a code comment that had become false after the
rewrite — it described the old bug as if it were the current mechanism — which was corrected.

## Still needs the user

Corpora are not on disk. VoxVietnam needs an HF token from an account that accepted its conditions;
Vietnam-Celeb needs a manual Drive download with its licence resolved with the authors. Both are
deliberately the user's acts.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
