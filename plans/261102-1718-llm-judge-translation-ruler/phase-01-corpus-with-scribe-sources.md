---
phase: 1
title: 'Corpus with Scribe sources'
status: completed
priority: P1
effort: '1d'
dependencies: []
---

# Phase 01: Corpus with Scribe sources

## Goal

Produce `data/turns.jsonl`: one row per prod turn with the prod source, an independent Scribe source, the prod translation and the previous four utterances, from at least 5 recorded conversations and at least 150 turns.

## Context

- `ConversationTurn` has `position`, `sourceText`, `displayText`, `sourceLanguages`, `translations` and `offsetMs`. `Conversation` has `audioKey`, `audioOffsetMs` and `audioDurationMs` (`apps/api/prisma/schema.prisma`).
- `benchmarks/stt/scripts/prod-audio-arms/README.md` documents the read-only route: `index.tsv`, `<clientId>.webm` from `R2_PUBLIC_BASE_URL/<audioKey>`, and `<clientId>.turns.tsv` with `offsetMs`.
- `benchmarks/stt/stt_bench/scribe_reference.py` (`reference_words`) drops Scribe's `audio_event` and `spacing` entries. Reuse it; do not copy it.
- `benchmarks/conversation-context/export-turns.mjs` (`draftRows`) already maps stored turns to `direction`, `source` and `draft`. Reuse it.
- `benchmarks/lid/arms/scribe_ceiling.py` shows the Scribe request and the key-from-file convention (argv is visible in `ps`).

## Files to create

- `benchmarks/translation-judge/README.md`: purpose, steps, the consent section, and what the numbers mean.
- `benchmarks/translation-judge/export-conversations.mjs`: read-only psql query for turns plus `offsetMs`, and the conversation's `audioKey`/`audioOffsetMs`. It downloads the webm, writes `data/<clientId>.turns.jsonl`, and builds `context` (the previous 4 same-conversation sources).
- `benchmarks/translation-judge/scribe_turns.py`: a `--consent-recorded` gate, one Scribe v2 call per recording (the key comes from `--token-file`), cached as `data/<clientId>.scribe.json`. It slices `reference_words` into turns by `[offsetMs − 150, nextOffsetMs + 150)` relative to `audioOffsetMs`, and writes `scribe_source` into `data/turns.jsonl`.
- `benchmarks/translation-judge/tests/test_scribe_turns.py`: the slicer on synthetic word lists (boundary words, padding overlap, last turn, missing `offsetMs` gives `scribe_source=null`).
- `.gitignore`: `benchmarks/translation-judge/data/` and `benchmarks/translation-judge/results/`.

## Tasks

1. List candidate conversations read-only. They must have `audioKey`, ≥ 20 turns, all turns with `offsetMs`, and a mix of vi→en and en→vi. Propose 5–7 to the maintainer, including at least one with domain terms. The 3 conversations of the `conversation-context` corpus may be reused if they have recordings.
2. Write the README consent section naming whose voices these are before any Scribe call.
3. Export, then run Scribe with `--consent-recorded` (≤ 7 calls).
4. Check slicing on 10 random turns by reading `source` beside `scribe_source`. Record the mismatch count in the README; if more than 2 of 10 are off by a whole clause, fix the slicer before Phase 02.
5. Rows without an `offsetMs` or with an empty `scribe_source` are kept but flagged `scribe_missing`, and the judge sees only the prod source for them. Report their count.

## Verification

- `cd benchmarks/stt && uv run --group dev pytest ../translation-judge/tests/test_scribe_turns.py` (the `benchmarks/stt` env provides `stt_bench`)
- `wc -l data/turns.jsonl` reads at least 150, and the conversation count is at least 5.
- `git status` shows no file under `data/`.
