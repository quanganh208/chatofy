# live-translate harness

Measurement-only harness comparing the project's turn-based cascade against
Google's end-to-end `gemini-3.5-live-translate-preview`, for the thesis
comparison chapter. **Not** part of the pnpm/turbo workspace and never imported
by the app — same convention as `benchmarks/stt`, `benchmarks/tts` and
`benchmarks/realtime`.

| Script               | What it produces                                               |
| -------------------- | -------------------------------------------------------------- |
| `build-fixtures.mjs` | 50 real utterances per direction, padded, with a manifest      |
| `vad-anchor.mjs`     | The common time origin, and the output-onset detector          |
| `run-arms.mjs`       | Both arms, interleaved, real-time paced → `rows.jsonl` + audio |
| `analyze.mjs`        | The latency table, stratified by utterance length              |
| `score-adequacy.py`  | Judge-ASR → chrF++ + COMET (standalone `uv` project)           |

Nothing under `data/` or `results/` is committed. VIVOS is CC BY-NC-SA 4.0 —
measurement use only, no redistribution.

## The arms

|        | cascade                                                                                                 | live                               |
| ------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Path   | `/ws/translate`                                                                                         | `/ws/live-translate`               |
| Stages | local STT → Gemini MT → local TTS                                                                       | one model, speech to speech        |
| Config | the shipped default: `AI_STT_PROVIDER=local`, `AI_TRANSLATION_PROVIDER=gemini`, `AI_TTS_PROVIDER=local` | `AI_REALTIME_PROVIDER=gemini-live` |
| Unit   | a turn                                                                                                  | a session, one per utterance       |

The cascade under test is the **shipped default**, because that is the product.
An ElevenLabs-backed cascade is a different system and cannot share a row.

## The anchor, and why the obvious one is wrong

Every latency figure is milliseconds from the **offline-VAD end of speech in the
source recording**. Not from `client.session.end`, and not from `speechEndedAt`.

Those two are the same moment, and it is the _gate's close time_: the true end of
speech **plus** `SPEECH_HANGOVER_MS` (500 ms). Trace it:
`speech-gate.ts:212-215` → `turn-pipeline.ts:325` → `conversation-session.ts:519`.

Two things follow. Gemini has no such moment at all, so there is nothing on its
side to anchor to. And the hangover is real waiting a listener feels that the
cascade's existing rows do not count — so anchoring there would quietly flatter
our own system by half a second.

The VAD belongs to neither system. Its implementation is **reused** from
`benchmarks/realtime/vad-reference.mjs` rather than rewritten, because two
definitions of "where speech is" would drift.

## The cascade's endpoint — the decision that sets fairness

Nothing in this repo speaks the turn contract headlessly, so `run-arms.mjs`
implements that client itself. It therefore chooses when to send
`client.session.end`, and that choice _is_ the cascade's measured latency:

- at the VAD end exactly → the cascade gets an **oracle endpoint** no real client
  has. That is the same error as anchoring on `speechEndedAt`, committed in the
  opposite direction.
- at VAD end **+ 500 ms** → reproduces the shipped `SpeechGate`.

**The harness sends at VAD end + 500 ms and never sends
`client.turn.speculate`.** The shipped client does speculate, so the cascade's
real latency is **at most** what this reports. Every simplification biases
against our own system, which is the safe direction to be wrong in. The chapter
must say this in as many words.

## What makes each number honest

- **Real human speech.** VIVOS test split (vi) and LibriSpeech test-clean (en),
  50 utterances per direction, seed 42, 3–10 s — the same corpora and seed
  `benchmarks/stt` uses. Synthesized fixtures are off-distribution for both
  systems' front ends and are the easiest thing for an examiner to attack.
- **4 s of trailing silence** after every utterance. Not cosmetic: the
  continuous model has no endpoint event and reads quiet as the end of an
  utterance — cutting the stream at the last speech sample returns a truncated
  translation, measured. It is also what makes a continuous system's output
  attributable to one input utterance without forced alignment.
- **Real-time pacing**, 100 ms chunks, both arms. Feeding faster makes both
  latency figures fiction.
- **Interleaved.** Utterance _i_ through both arms back to back, same machine,
  one window. A preview model updated between two sequential arms would
  invalidate the chapter silently. Model id and date land on every row.
- **One measurement boundary.** Both arms are timed _in this process, on
  receipt_. Taking the cascade's numbers from its server-side JSONL and the live
  arm's from here would be an asymmetry a committee can attack — which is why
  the server's own `live` rows are operational telemetry, not evidence.
- **First audio means first speech.** The onset detector is a tested function
  (`vad-anchor.mjs --self-test`), because the live model mirrors input silence
  back into its output and a first-audio timestamp that measured a silence frame
  would look perfectly reasonable in the table.
- **Stratified by utterance length.** The continuous model translates
  mid-utterance, so its advantage grows with length: the spike measured +240 ms
  on a 3.1 s clip and −2961 ms on a 6.6 s one. An unstratified mean lets whoever
  chose the fixtures choose the result.
- **Exclusions are counted.** Error and quota rows leave the percentiles and
  appear as their own per-arm number.

## What is NOT comparable, and never shares a column

Cascade-only: `translatedAtMs`, clause counts, speculation counters, capture
coverage. Live-only: wrong-language-output rate, ongoing lag within a long
utterance. Both: bytes uploaded per conversation — the live path streams
continuously while the cascade gates, which is a real cost difference and not a
defect in either.

## Running it

```bash
# 1. The API, the two speech sidecars, and a Gemini key.
#    apps/api/.env must have AI_REALTIME_PROVIDER=gemini-live (an older .env
#    may still say `none`, which refuses every live session).
pnpm dev:all

# 2. Fixtures. Needs ffmpeg: LibriSpeech is served as FLAC, VIVOS as WAV.
#    Both are already 16 kHz mono, so this is a container change, not a resample.
node benchmarks/live-translate/build-fixtures.mjs

# 3. Reference translations — see below. Nothing scores adequacy without them.

# 4. Both arms. ~7 minutes of wall clock per 10 utterances, since it is paced.
node benchmarks/live-translate/run-arms.mjs --api http://localhost:3000

# 5. The latency table.
node benchmarks/live-translate/analyze.mjs benchmarks/live-translate/results/<stamp>/rows.jsonl

# 6. Adequacy. Downloads Whisper large-v3, PhoWhisper-large and COMET — ~8 GB
#    on first run, and transcribes 200 clips on CPU. Budget an hour.
#    PYTHONUNBUFFERED matters when redirecting: without it Python holds every
#    print in a buffer and the log stays empty until the process exits, so a run
#    that is working looks identical to one that has hung.
cd benchmarks/live-translate && uv sync
PYTHONUNBUFFERED=1 uv run python score-adequacy.py results/<stamp>/rows.jsonl | tee adequacy-run.log
```

Smoke it first: `--only vi --limit 3` costs three sessions and proves the whole
chain before a full run spends quota.

## Reference translations

VIVOS and LibriSpeech ship **transcripts, not translations**, so
`referenceTranslation` is `null` on every manifest row and `score-adequacy.py`
refuses to run until they are filled. It refuses rather than skipping, because a
score computed over whichever subset happened to have references is a number
nobody chose.

The accepted default, pending supervisor confirmation: translate with a strong
external MT system that sits in **neither arm** — not Gemini, not the local stack
— then post-edit as the bilingual author, and disclose them in the chapter as
post-edited pseudo-references. If that is refused, the latency chapter stands on
its own; adequacy becomes future work.

## Naturalness

Not automated here. A blinded listening panel (8–12 listeners, 5-point,
randomized order, mean ± CI) judges the output audio; adequacy is judged on
transcripts. They are kept apart so voice preference cannot leak into the
adequacy number. UTMOS is English-trained and NISQA needs an explicit caveat, so
neither is a drop-in substitute for Vietnamese.

## Unresolved questions

- Are post-edited pseudo-references acceptable to the committee?
- Is a classmate listening panel acceptable, or is an automatic predictor
  expected?
- Free-tier quota held for a handful of spike sessions; a 100-session run is
  untested. If 429s appear, cut to 30 utterances per direction and state the
  reduced n rather than truncating silently.
