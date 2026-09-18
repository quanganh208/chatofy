# Phase 1 — Contextual biasing through the hotwords that already exist

## Context

`TranslationHints.hotwords` is already carried per session and already reaches
the translator's prompt. Its own doc comment says a hotword "earns its place
precisely when the recognizer got the word wrong" — and today it never reaches
the recognizer. This phase closes that gap.

Measured on the production recording with the dev sidecar:

| Decoding             | WER vs reference | RTF    |
| -------------------- | ---------------- | ------ |
| greedy (today)       | 0.150            | 0.0171 |
| modified_beam_search | 0.137            | 0.0248 |
| beam + 13 terms @1.5 | 0.136            | 0.0233 |

`GIẢI QUỐC CƠ` becomes `GIẢI POKER`; `SIÊU THỊ TA GHÉT … SEARCH TA GHÉT` becomes
`SIÊU THỊ TARGET … SEARCH TARGET`. A hotword list that does not apply leaves the
output byte-identical.

## Requirements

Two of these were settled against an earlier assumption, by measurement — see
`docs/development-journey.md`, section dated 18/09.

- `greedy_search` stays the default. `development-journey.md` 3.10 recorded that
  decision on 28/08 with numbers, and a turn that names no term must decode
  exactly as it did before.
- A second `modified_beam_search` recognizer beside it, chosen only when the turn
  carries terms. Measured cost: +59 MB RSS, RTF 1.36x on the biased turn.
- **No standing base list.** One was built and measured: 28 common English words
  moved WER from 0.137 to 0.148 on this material, a list of 20 distinctive ones
  to 0.150, because biasing towards a word nobody said costs real Vietnamese.
- Hotwords arrive per request and per stream, so one pair of recognizers serves
  every conversation.
- Biasing score 1.5. At 3.0 a multi-word entry truncates the clause around it.
- English engine unchanged: Moonshine is not a transducer and takes no hotwords.

## Files

- `services/local-stt/engines/zipformer_vi.py` — decoding method, bpe vocab, hotword score
- `services/local-stt/engines/base.py` — `transcribe(samples, hotwords=None)`
- `services/local-stt/engines/registry.py` — pass-through if it wraps transcribe
- `services/local-stt/scripts/download_models.py` — generate `bpe.vocab` beside `tokens.txt`
- `services/local-stt/app.py` — optional `hotwords` form field on `/transcribe`
- `services/local-stt/hotwords.py` (new) — normalise, dedupe, cap
- `services/local-stt/test_app.py`, `services/local-stt/README.md`
- `packages/ai-providers/src/interfaces/stt-provider.ts` — optional options arg
- `packages/ai-providers/src/providers/local-speech/local-speech-stt-provider.ts`
- `apps/api/src/modules/translate/services/pipeline-translator.service.ts`
- `apps/api/src/modules/translate/session/live-preview.ts`

## Steps

1. Generate `bpe.vocab` from the model's own `bpe.model` when it is missing —
   the weights are already downloaded on every machine that runs this, so it
   cannot be a download-time-only step.
2. Build the recognizer with `modified_beam_search`, `modeling_unit="bpe"` and
   that vocab; keep `hotwords_score` a named constant.
3. Thread an optional hotword list from `/transcribe` to `create_stream`.
4. Normalise: upper-case (the model's own casing), drop empties, cap the list.
5. Carry `hints.hotwords` from the session into both transcribe call sites.

## Validation

Done, on the shipped code path through the HTTP endpoint:

- `uv run --directory services/local-stt pytest` — 37 passed.
- `pnpm --filter api test` — 1039 passed; `typecheck` clean.
- Unbiased decode of the 1:50 window reproduces production's stored text exactly
  ("Giải quốc cơ ở mỹ…"), so the default really is untouched; the same window
  with `hotwords=POKER` returns "Giải poker ở mỹ…".
- Over all 53 windows: unbiased WER 0.159 at RTF 0.0225, and with four of the
  conversation's own terms 0.142 at RTF 0.0306.

## Risk and rollback

Beam search costs ~45% more STT compute than greedy — 58 ms becomes ~84 ms
against a p50 budget of 1163 ms. Rollback is one constant: put
`decoding_method` back to `greedy_search`, and hotwords become inert.
