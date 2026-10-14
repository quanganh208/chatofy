# Homophone repair ruler

Whether the display repairs the Vietnamese words the recognizer heard as a sound-alike, and only those. Examples: "đâm giao" becomes "đâm dao", "chiều cường" becomes "triều cường", "đạt đinh" becomes "đạt đỉnh".

It runs the shipped pieces end to end, so a number here describes production:

- the repair prompt on the production host (`HOMOPHONE_REPAIR_INSTRUCTION`);
- the guard (`acceptHomophoneRepairs`);
- the application to the line (`applyTranscriptCorrections`).

```bash
pnpm --filter @chatofy/ai-providers build      # the ruler loads the built package
node benchmarks/homophone-repair/score.mjs --repeats 3
```

The script takes `DEEPSEEK_API_KEY` from the environment, falling back to `apps/api/.env`. It never prints the key. In non-thinking mode the host pins `temperature` to 1.0, so use `--repeats`.

## Two numbers

- **WER before and after** the accepted repairs, over the recognizer's turns, against the reference.
- **Repairs on the reference.** The same prompt and guard run over the reference itself, cut into turn-sized chunks. The reference is already right, so every repair accepted there is a word changed that should not have been. WER alone cannot show that: a model that fixes nine words and breaks two still lowers it.

The script also prints the call latency. Every call of a conversation is in flight at once, so it is the latency under that load.

## Data

`data/` is gitignored, because the turns are production transcripts.

`data/conversations.json` holds `[{ "id", "turns", "reference" }]`:

- `turns` is each turn's transcript, lowercased: the recording replayed through the shipped `CapturePump` (continuous, full duplex, 8 s ceiling), and each emitted turn decoded by a separate copy of the production STT sidecar with the same model files. Never the production sidecar itself: one long decode there was killed at its memory limit.
- `reference` is ElevenLabs Scribe v2 on the whole recording, with its `audio_event` tags removed.

## Recorded

2026-10-13, 6 Vietnamese conversations (2,220 reference words), 3 runs, with the guard as shipped: WER 5.86% → 5.50% in each, 8 repairs accepted in each, 1 repair on the reference in each.

- **Accepted:** đâm giao → đâm dao (twice), giao động → dao động, chiều cường → triều cường, đạt đinh → đạt đỉnh, vươn → vườn, vạ → và, trợ lách → chợ lách. All right, and each differs from what was heard in exactly one of onset, rhyme and tone.
- **On the reference:** "lướng lự" → "lưỡng lự", which is a typo in the reference, so the right answer.
- Latency: p50 785–828 ms and p90 962–1041 ms over two sessions; the host's own latency moves by more than that within an hour. Against the translation of the same turn, both in flight together, the repair finished first on 65 of 94 turns. A 250 ms grace after the translation lost it on 4.

### The guard

- **One place.** A repair names the words at one place in the transcript. A run heard twice is refused, because "đâm giao rồi giao hàng" has one misheard "giao" and one right one. In a block of turns, each repair is moved by the words of the turns before it.
- **One difference.** Each changed word must share the sound key of the word heard (onsets d/gi/r, tr/ch, s/x merged; codas n/ng, t/c merged) and differ from it in only one of onset, rhyme and tone. A pair that needs two ("rán"/"giáng") is a pair no listener confuses.
- **No quantities.** A repair touching a number word is refused: the ITN runs after it, so "phim ba chiều" read as "ba triệu" would print "3 triệu".
- **No rewriting.** 1–3 words, the same count, at most 4 proposals per turn, and overlapping repairs keep only the first.

### What the measurements decided

- **The tone is not compared.** An earlier guard that compared it refused "đạt đinh" → "đạt đỉnh" and "vươn" → "vườn" and caught no wrong repair.
- **No translation in the request.** Given the translation as well, the model gave the same answers, so the repair runs beside the translation instead of after it.
- **The sentences before are named as recognizer output.** Without that sentence in the prompt, the model "repaired" a right "chợ lách" to match an uncorrected "trợ lách" two turns earlier.
- **Examples in the prompt are synthetic.** The first prompt used "đâm giao" and "thủy chiều", which are in this set. Replacing them with "con dán" and "chồng cây" changed no answer, so the result does not come from the examples.

What it cannot see: a word misheard as one that does not sound alike ("về" for "với", "kẻ sọ" for "kè rọ"). The guard refuses those by design, because it cannot tell a misheard word from a rewritten one.
