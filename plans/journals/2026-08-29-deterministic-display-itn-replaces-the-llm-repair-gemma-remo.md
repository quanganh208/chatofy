---
title: Deterministic display ITN replaces the LLM repair; gemma removed
date: 2026-08-29
summary: 'Recall 0.8810 -> 1.0000, 0 hallucinations, 25.1s -> 0.21ms; 2,423 lines deleted; A13b still needs a browser'
---

# Deterministic display ITN replaces the LLM repair; gemma removed

## What happened

The shipped Vietnamese display repair worked — numerals 0.8810, punctuation F1
0.7222, proper-noun caps 0.8636, 0 hallucinations — and was rejected anyway. Over
22 measured turns it landed at a median of **25.1s**, max 92.6s, and a **minimum
of 10.0s**. Not one repair in 22 arrived inside ten seconds. A correction nobody
can read in time is not a correction.

Replaced it with a deterministic inverse text normalizer: a pure function over a
string, computed **before** the transcript event is emitted and carried **on**
that event.

| metric                     | LLM          | ITN                                          |
| -------------------------- | ------------ | -------------------------------------------- |
| numeral recall (in-sample) | 0.8810       | **1.0000** (42/42)                           |
| numeral hallucinations     | 0            | **0** in-sample, **0** on both held-out sets |
| held-out round-trip recall | —            | vi 1.0000 (51/51), en 1.0000 (21/21)         |
| punctuation F1             | 0.7222       | **0.0000**                                   |
| proper-noun capitalization | 0.8636       | **0.0000**                                   |
| added latency              | 25.1s median | **0.21 ms** p95                              |

VIVOS WER unchanged at 5.38% (CER 2.90%), re-measured. `gemma-4-31b-it` removed
from every model list, prompt, benchmark and current doc. 2,423 lines deleted.

## What the three evidence tiers each caught

The strongest argument for building all three is that each found defects the
others could not:

- **In-sample (22 utterances)** — the month run swallowing a whole year
  (`tháng chín năm một chín bốn năm` read as month 951945), and a bare `mười`
  failing to parse so every `mười giờ` lost its clock.
- **Held-out negatives (50 VIVOS + 50 LibriSpeech)** — four hallucinations, none
  reachable from the in-sample set: `MƯỜI MỘT MƯỜI HAI MƯỜI BA` -> `43` (three
  numbers merged into a fourth nobody said), `PHÒNG BA LE HAI` -> `PHÒNG 3 LE 2`
  (a name), `CHỊ HAI` -> `CHỊ 2` (a kinship form of address), `HAI CHA CON` ->
  `2 CHA CON` (an idiom).
- **Held-out round-trip (70 written sentences)** — four more: a unit vouching for
  the NEXT number (`850.000 đồng một đêm` -> `đồng 1 đêm`), the empty hundreds
  place of a year stranding its tail (`hai nghìn không trăm hai mươi sáu` ->
  `2000` + loose words, twice), and English `nineteen ninety eight` never
  reaching 1998.

## Decision

**One candidate span yields exactly one numeral, or nothing. Never a fragment.**
The previous prototype emitted `2.000 500` for `hai nghìn năm trăm` — a partial
parse published as two pieces. Ambiguity now becomes recall loss, never a wrong
digit.

That trade is not symmetric, which is why it is the rule. `không` is both the
number zero and the ordinary Vietnamese negation, so digitizing it does not make
a sentence wrong — it **reverses** one, on screen, in the speaker's own words,
with nothing marking it. A missed numeral is a number a reader can still read as
words.

Every rule is statable as a fact about the language rather than about a corpus
row: `mười` takes no multiplier; a lone number word needs a neighbour, and an
ambiguous one needs a true classifier rather than a positional noun (Vietnamese
names rooms and people by birth order); evidence is read from the right because
the classifier follows its number.

Two costs accepted in the open: punctuation and proper-noun capitalization go to
zero, and English has no in-sample spoken recall figure at all because no such
corpus exists.

## Next steps

- **A13b is the one criterion not met.** The server half is verified live — three
  real turns through the real WebSocket with real audio, each carrying its digits
  on the transcript event, zero second events. The browser half needs a person:
  proving a single commit with no words-form flash needs a screen recording, and
  no live partial line was observed to write down. `pnpm dev`, sign in, speak one
  sentence with a date and a time, record the screen. About an hour.
- Held-out **spoken** recall still needs new audio, and that cost is still not
  established. The round-trip set is clean text and measures the grammar, not the
  pipeline.
- `server.transcript.display` and the `repairDisplay` client flag are now dead
  surface and a misnomer respectively. Both are breaking changes, deliberately
  not taken; they can go together once no old client remains.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
