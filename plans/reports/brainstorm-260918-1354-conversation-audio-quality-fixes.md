---
type: brainstorm
date: 2026-09-18
subject: Fixing the quality defects found in production conversation f35c2816
status: awaiting scope decision
---

# Fixing the defects found in conversation `f35c2816`

## Summary

Deep audio analysis of the production recording turned one of the three
suspected causes into a measured, reproducible experiment with a proven fix, and
demoted another. The Vietnamese recogniser is better than the stored transcript
suggests: given the same audio, contextual biasing recovers the words that
carried the meaning, at a latency cost this system can absorb.

## Contract

**Outcome.** A conversation of this kind — spontaneous Vietnamese with English
brand and domain terms mixed in — produces a transcript whose meaning-bearing
words are right, and the transcript covers all the speech that was recorded, from
the first word to the last.

**Constraints.**

- Speech stays local and on CPU. No cloud STT.
- The live latency budget holds: p50 1163 ms, p95 2983 ms end to end today, of
  which STT is 58 ms. A fix may spend tens of milliseconds there, not hundreds.
- The recogniser is CC-BY-NC-ND; it may be configured, not retrained or
  redistributed.
- `@chatofy/realtime-client` is shared with the extension, so a client-side fix
  must not make the web app a special case.
- No schema change unless a chosen option genuinely needs one.

**Non-goals.**

- Replacing the Vietnamese model (PhoWhisper, Whisper-large) — measured at
  ~1.3 s per utterance, which the live path cannot pay.
- Changing how the translator phrases its output, beyond not inventing content.
- Retrofitting past conversations. The fix applies from here on.

**Acceptance criteria.**

1. Re-running this recording's utterance windows through the sidecar yields
   "poker", "Target" and "search" where the speaker said them, with no
   regression in aggregate WER against the reference transcript (baseline:
   greedy 0.150, beam 0.137 on the same harness).
2. STT RTF stays under 0.03 (today 0.017 greedy; measured 0.022 with biasing).
3. Speech recorded before the socket is live either reaches the recogniser or is
   not recorded at all — the transcript and the recording agree at both ends.
4. A test encodes each of the above so the next change cannot silently undo it.

## Evidence gathered

All measured on this machine against the production recording, using the **dev**
STT sidecar (`127.0.0.1:8002`) so the production stack was never disturbed.

### The recogniser already knows these words

Decoding the 1:50 window exactly as production framed it (110.59–115.74 s)
reproduces the production error — "GIẢI QUỐC CƠ". Widening the same decode to
include six seconds of **preceding** audio produces "GIẢI POKER". Future audio is
not needed, so this is implementable live.

| Window              | Result                                |
| ------------------- | ------------------------------------- |
| turn window only    | `GIẢI QUỐC CƠ Ở MỸ HOẶC LÀ ÚC`        |
| + 4 s of past audio | `GIẢI QUỐC CƠ …`                      |
| + 6 s of past audio | `… TÔI SẼ ĐI MỘT CÁI GIẢI POKER Ở MỸ` |

But it does not generalise: "Target" never recovers with context alone, and
re-decoding the whole conversation with 6 s of left context did **not** improve
aggregate WER (0.140 vs 0.150 for the same harness without it). Context is a fix
for one sentence, not for the class.

### Contextual biasing does generalise, and is cheap

sherpa-onnx exposes hotword biasing on this transducer
(`hotwords_file` / `hotwords_score` with `modeling_unit="bpe"` and a `bpe.vocab`
generated from the model's own `bpe.model`), and hotwords can also be passed
**per stream** — `create_stream(hotwords="POKER/SEARCH")` — so a list can be
per conversation without rebuilding the recognizer. Verified: an unrelated
hotword list leaves the output byte-identical, so biasing costs nothing when it
does not apply.

Measured over all 53 utterance windows:

| Decoding             | WER vs reference | RTF    |
| -------------------- | ---------------- | ------ |
| greedy (today)       | 0.150            | 0.0171 |
| modified_beam_search | 0.137            | 0.0248 |
| beam + 8 terms @1.5  | 0.141            | 0.0221 |
| beam + 13 terms @1.5 | 0.136            | 0.0233 |
| beam + 13 terms @2.0 | 0.135            | 0.0221 |

And on the sentences that carried meaning:

- `GIẢI POKER Ở MỸ HOẶC LÀ ÚC` — correct.
- `SIÊU THỊ TARGET BẠN CỨ SEARCH TARGET LÀ MỤC TIÊU` — correct, where production
  stored "siêu thị ta ghép … search ta ghét".
- A control Vietnamese turn with no hotword in it is unchanged.

Two cautions the sweep also produced. A short list biased at 1.5 fixed "Target"
but broke the neighbouring "SEARCH" into "SH" — adding the neighbouring English
words to the list fixed both, so the list must cover the domain's English
vocabulary, not only its proper nouns. And at score 3.0 the multi-word entry
"FIRST IN FIRST OUT" truncated the sentence around it; 1.5–2.0 is the usable
band, and multi-word entries are the weakest case.

Aggregate WER is the wrong headline metric for this fix: the words at stake are
two tokens in 867, so the honest acceptance test is term accuracy on a named list
plus "WER must not get worse".

### Confidence is available, and is a partial signal

The transducer returns `ys_log_probs` per token. The three worst-scoring
multi-token turns in the conversation are exactly the three English-contaminated
ones (−0.470 "what's up baby", −0.292 the PewPew turn, −0.287 the FIFO turn,
against a median of −0.144). One-token filler turns score worse than all of them,
so any threshold needs a minimum token count. It would catch a fully English
utterance; it does **not** flag a single English word inside a Vietnamese
sentence — turn 24 ("poker") scores a perfectly ordinary −0.122.

The English model, run on the same windows, transcribes the genuinely English
burst correctly ("What's up my babe?") and hallucinates fluent repetitive
nonsense on Vietnamese ("I'm going to say it again…"), which is itself
detectable. Moonshine exposes no log-probs, so a cross-model score comparison is
not available.

### The lost ends

The opening is diagnosed: `ConversationSession.start()` attaches the
`MediaRecorder` inside `openMicrophone()`
(`apps/web/src/hooks/use-streaming-translate.ts:288`) and only connects capture
after `audioWorklet.addModule` and `socket.connect()` have resolved, so speech in
that window is recorded and never sent. Measured here: at least 1.70 s, at most
2.67 s. The ending — about 8 s — has the same symptom and is under separate
diagnosis.

## Options for the recogniser

**A. Contextual biasing (recommended).** Switch the Vietnamese engine to
`modified_beam_search`, ship a `bpe.vocab`, keep a small built-in list of the
English words this product's speech actually contains, and pass the
conversation's glossary terms per stream on top. _Depends on:_ the terms being
knowable before the utterance. _Fails first when:_ the speaker uses an English
word nobody listed — biasing does nothing and the output is what it is today.
Cheapest to abandon: it is a decoding config, not a contract.

**B. Confidence-gated English second pass.** When a turn has enough tokens and
scores badly, decode it again with Moonshine and choose. _Depends on:_ the
threshold separating English from ordinary bad Vietnamese, which the data
supports only for whole-utterance English. _Fails first when:_ a noisy
Vietnamese turn scores low and is replaced by confident English hallucination —
the worst failure this product can produce. Would need the repetition detector to
be safe.

**C. Longer decode context.** Feed the recogniser the previous ~6 s along with
the utterance and keep only the new tokens by timestamp. _Depends on:_ context
helping in general, which the sweep does not support (0.140 vs 0.150 on the same
harness, and "Target" unrecovered). Rejected on its own evidence; worth
revisiting only as a second-order tweak after A.

**Recommendation: A now, B later behind a measurement.** A is proven on this
recording, costs ~5 ms per utterance, needs no schema change, and reuses the
glossary the product already has. B is the only thing that can fix a fully
English sentence, but it can also make the product lie more confidently than it
does today, so it should not ship before A has removed the easy cases and a
repetition guard exists.

## Unresolved questions

- Should the hotword list be the user's existing `GlossaryTerm` rows (the table
  exists and is empty in production), a built-in English list, or both? Both is
  the recommendation, but the glossary is a user-facing surface and its wording
  cap was already tuned for the translation side.
- The lost ~8 s tail: diagnosis is in flight and may or may not share a cause
  with the opening.
- Should the real-world WER (13.4%) be recorded next to the 5.38% benchmark in
  `services/local-stt/README.md`?
