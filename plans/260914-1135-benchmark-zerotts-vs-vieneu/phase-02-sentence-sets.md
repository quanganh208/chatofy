---
phase: 2
title: 'Sentence sets'
status: completed
priority: P1
effort: '2h'
dependencies: []
---

# Phase 2: Sentence sets

## Goal

Produce the two Vietnamese sentence sets both engines are measured on, each
carrying the reference text phase 4 scores against — and settle the orthography
policy that decides whether the WER measures intelligibility or punctuation.

Independent of phase 1; this phase writes only `benchmarks/tts-vi/data/`.

## Read first

- `docs/development-journey.md`, the clause-splitting table (search `Cắt mệnh đề`)
  — the register the app actually produces
- `benchmarks/stt/README.md` — **specifically the section on number formatting
  and WER**, which documents this exact trap with a worked example
- `benchmarks/stt/data/manifest-vi.jsonl` — the 50 VIVOS rows
- `benchmarks/stt/stt_bench/text_normalize.py` — note "numbers are left as
  written, by design"
- `apps/api/src/modules/translate/audio/clause-splitter.ts` — phase 3 ports its
  splitting rule, so the sentences must contain realistic clause boundaries

## Files to create

- `benchmarks/tts-vi/data/sentences-conversational.jsonl`
- `benchmarks/tts-vi/data/sentences-vivos.jsonl`
- `benchmarks/tts-vi/scripts/build_vivos_set.py`

Row shape `{"id", "text", "ref_text", "tags"}` — `text` is synthesized,
`ref_text` is what the transcript is scored against. Ids must be globally unique
across both files, since they share one results tree: prefix them (`conv-001`,
`vivos-VIVOSDEV01_R044`).

## The orthography policy — decide this first

The round-trip scores an ASR transcript against the **input string**, so every
place the TTS legitimately verbalizes a number or an abbreviation costs word
errors that say nothing about intelligibility. `benchmarks/stt/README.md` already
documents the failure: a hypothesis correctly rendering `17:00` scores three word
errors against a reference reading `MƯỜI BẢY GIỜ`. The vendored normalizer leaves
numbers as written, by design.

VIVOS hides this — none of its 50 references carry a digit or a punctuation
mark. The conversational set will not, because it is deliberately about prices,
times, and bookings.

**Policy: authored `text` spells out every numeral, time, and currency amount in
Vietnamese words, and contains no abbreviations.** Write it in the data file
header and enforce it in the build check. This keeps WER about the audio.

## Tasks & Steps

1. **Author the conversational set**, ~40 sentences, in the register the app
   emits: Gemini's Vietnamese translations of conversational English — prices,
   ordering, directions, booking, apologising. Spread the lengths and tag each
   row `short`/`medium`/`long`; RTF and TTFA behave differently across them.
   Include realistic clause boundaries (commas, mid-sentence punctuation), since
   phase 3's clause-split TTFA arm needs something to split on.

2. **Apply the orthography policy** to every authored row: "bảy giờ tối", not
   "7 giờ tối"; "hai trăm nghìn đồng", not "200.000đ".

3. **Include a code-switching subset**, 8–10 rows tagged `code-switch`, with
   embedded English words and proper nouns — `wifi`, `taxi`, `check-in`, a hotel
   or brand name. ZeroTTS specifically claims this, and real translated output
   contains it.

   **Record the known scoring hazard in the file header**: the normalizer splits
   `check-in` into two tokens, so a transcript of `checkin` costs word errors
   regardless of audio quality. On a 10-row subset that is not a rate worth
   quoting. Phase 4 therefore reports **CER as primary** here and hand-reviews
   all ten hypotheses.

4. **Label the set honestly in its header**: this is an in-domain,
   author-chosen set, not an adversarial one, and its author is also the person
   judging the outcome. That belongs on the artifact, not only in the report.

5. **Build the VIVOS set.** `build_vivos_set.py` reads
   `benchmarks/stt/data/manifest-vi.jsonl` and emits the 50 rows with prefixed
   ids. Read that file; do not modify it.

6. **Casing.** VIVOS `ref_text` is ALL CAPS. ZeroTTS processes raw orthography
   with no grapheme-to-phoneme stage, so casing can reach the model.
   Synthesize from a sentence-cased `text`, keep the original caps in
   `ref_text`, and let the normalizer (which lowercases) reconcile them. State
   this in the data file header.

7. **Verify** both files load through the rewritten `load_sentences`, ids are
   unique across both files, and no authored row contains a digit.

## Verification

```bash
cd benchmarks/tts-vi
uv run python scripts/build_vivos_set.py
uv run python -c "
import json, pathlib, re, sys
rows, ids = [], set()
for p in sorted(pathlib.Path('data').glob('sentences-*.jsonl')):
    got = [json.loads(l) for l in p.read_text(encoding='utf-8').splitlines()
           if l.strip() and not l.startswith('#')]
    assert got, p
    for r in got:
        assert r['text'].strip() and r['ref_text'].strip(), (p, r['id'])
        assert r['id'] not in ids, f'duplicate id {r[\"id\"]}'
        ids.add(r['id'])
    rows += [(p.name, r) for r in got]
    print(p.name, len(got))
digits = [r['id'] for n, r in rows if n.startswith('sentences-conv') and re.search(r'[0-9]', r['text'])]
assert not digits, f'orthography policy violated: {digits}'
cs = [r for n, r in rows if 'code-switch' in r.get('tags', [])]
assert 8 <= len(cs) <= 10, len(cs)
print('ok', len(ids), 'unique ids,', len(cs), 'code-switch')
"
```

## Success Criteria

- [x] `sentences-conversational.jsonl` holds ~40 rows spanning short/medium/long
- [x] No authored row contains a digit — the orthography policy is enforced by the check, not just stated
- [x] 8–10 rows tagged `code-switch` with real embedded English
- [x] `sentences-vivos.jsonl` holds the 50 VIVOS rows with prefixed ids
- [x] Ids are unique across both files
- [x] Orthography policy, casing policy, code-switch scoring hazard, and the author-chosen caveat are all in the data file headers
- [x] `benchmarks/stt/` is unmodified

## Risk and rollback

Authored references mean WER measures the engines against what we intended, not
against a human reading. That is the correct choice for a TTS round-trip — no
human recording of these sentences exists — but the report must say so. Rollback
is deleting `data/`.
