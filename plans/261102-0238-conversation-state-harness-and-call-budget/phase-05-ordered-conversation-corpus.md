---
phase: 5
title: 'Ordered-conversation corpus'
status: completed
priority: P1
effort: '1d + user reference time'
dependencies: [1]
---

# Phase 05: Ordered-conversation corpus

## Goal

`benchmarks/conversation-context/` scores translation turn by turn, in conversation order,
against references the user wrote. It answers, before any digest code exists, whether a
**perfect** conversation state (built from the references) helps `deepseek-flash` at all.

This phase can run beside Phases 03–04. It depends only on Phase 01, for the `purpose` field.

> **State (2026-11-02):** the tools for Tasks 5.2, 5.4 and 5.5 are built and tested, with no paid call made. The 13 offline tests pass, the runner refuses an unfinished corpus with exit 2, and the export was checked read-only against two stored conversations (33 rows) whose data was then deleted. Task 5.1 still waits for the user's new long recordings.
>
> One change from the row format below: each kept term also carries a `target`, the rendering the user's reference uses. The oracle's glossary needs a rendering, and `mustMatch` is a regex, not a rendering. Anchoring-control rows are marked `"control": "anchoring"`.

> **Result (2026-11-02): NO-GO.** Terms-only run, 540 calls: term gain 0.033 [0.000, 0.089], 16+ gain 0.032 vs 1–5 gain 0.111, anchoring flips 8/33 vs 0/33. See `plans/reports/benchmark-261102-1702-conversation-context-oracle.md`. Phases 06–07 are cancelled.

## Context to read first

- `apps/api/prisma/schema.prisma` `model ConversationTurn` (~L279: `position`, `sourceText`, `sourceLanguages`, `translations Json`) and `model Conversation` (`clientId`, `ownerId`, `languages`).
- `benchmarks/error-analysis/README.md` and `benchmarks/error-analysis/term-rendering.mjs` (`scoreRow` uses `mustMatch` / `mustNotMatch` regex sources, no flags).
- `benchmarks/error-analysis/translate-rows.mjs` (refuses a corpus with a missing `reference` before the first paid call: copy that rule).
- `benchmarks/live-translate/score-adequacy.py` (chrF++), `benchmarks/mt-zh/paired-bootstrap.py`.
- `benchmarks/translation-providers.mjs` (`deepseek` preset; how a benchmark builds the shipped provider).
- `packages/ai-providers/src/providers/gemini/prompt-builder.ts`: the anchoring case documented above `MAX_FRAGMENT_WORDS` (~L72-104).

## Files to Create / Modify

- Create: `benchmarks/conversation-context/README.md`, `export-turns.mjs`, `run.mjs`, `score.mjs`, `score.test.mjs`, `anchoring-control.example.jsonl`
- Modify: `.gitignore` (add `**/benchmarks/conversation-context/data/` and `**/benchmarks/conversation-context/results/`)
- Create: `plans/reports/benchmark-<yymmdd-hhmm>-conversation-context-oracle.md`

## Row format (`data/corpus.jsonl`, one turn per line)

```json
{
  "conv": "<clientId>",
  "pos": 12,
  "direction": "vi_to_en",
  "source": "…",
  "draft": "<prod translation, a hint for the writer>",
  "reference": null,
  "terms": [{ "source": "VinFast", "mustMatch": "VinFast" }],
  "words": 14,
  "bucket": "6-15"
}
```

Plus, per conversation, one line in `data/conversations.jsonl`: `{"conv":"…","domain":null}`. The user writes `domain` (≤ 4 words) the same way as references; the oracle arm reads it.

## Tasks

### Task 5.1 — Is there enough conversation?

- Steps: read-only count of conversations with ≥ 20 turns, owned by the owner id from Phase 02 Task 2.3:
  `docker exec chatofy_prod_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT c.\"clientId\", count(t.id) FROM \"Conversation\" c JOIN \"ConversationTurn\" t ON t.\"conversationId\"=c.id WHERE c.\"ownerId\"='"'"'<owner>'"'"' GROUP BY 1 HAVING count(t.id) >= 20 ORDER BY 2 DESC"'`
- Pass condition: ≥ 2 conversations whose turns sum to ≥ 60.
- If it fails: STOP and tell the user the numbers. The options are (a) record new longer conversations, or (b) lower the bucket boundaries to 1–3 / 4–8 / 9+. It is their call (Failure Protocol does not apply: this is a data gap, not a failure).
- Verify: the command prints ≥ 2 rows and their counts sum to ≥ 60.

- **Re-ran 2026-11-02 after the new recordings: PASSED.** Three conversations reach 20 turns: 25320f62 (31, vi↔en), 2ee8e184 (27, an English podcast with no stored translations, so its rows have no `draft`) and a68ec3c8 (21), 79 turns in total.

- **Ran early on 2026-11-02 (read-only): FAILED the pass condition.** The owner has 15 conversations with 97 turns in total, bucketed by length: 1–4 turns ×6 (19 turns), 5–9 ×7 (45), 10–19 ×1 (12), 20+ ×1 (21). Only one conversation reaches 20 turns. **User chose (a) on 2026-11-02: they will record more long conversations** (≥ 2, about 30 turns each, with recurring names and terms). The buckets stay 1–5 / 6–15 / 16+. Re-run this task once they say the recordings exist.

### Task 5.2 — Export draft rows

- Target: `export-turns.mjs --conv <clientId,…>`. It reads via the same psql command, writes `data/corpus.jsonl` and `data/conversations.jsonl`, and never writes outside `data/`.
- Steps: per turn fill `source`, `draft` (the translation from `translations` for the conversation's other language), `words` (`countTermWords` from the built `@chatofy/types`), `bucket` from the turn index in that conversation (1–5, 6–15, 16+), `reference: null`, and `terms` pre-suggested as Latin-script or capitalised spans that already occurred in an earlier turn, each with `mustMatch: null`.
- Verify: `node benchmarks/conversation-context/export-turns.mjs --conv <ids>` exits 0 and `wc -l benchmarks/conversation-context/data/corpus.jsonl` ≥ 60.

- **Done 2026-11-02:** 79 rows exported (buckets 1–5: 15, 6–15: 30, 16+: 34; 15 term suggestions). The runner plans 237 calls per arm at `--repeats 3` and refuses the unfinished corpus with exit 2. The 13 offline tests pass.

### Task 5.3 — User gate: references

- Steps: tell the user the file path and exactly what to fill: every `reference`, `mustMatch` for each `terms` entry they keep (delete wrong suggestions), and `domain` per conversation. Model-written references are forbidden (plan.md decision). Also ask for ≥ 10 anchoring-control rows: complete sentences (≥ 5 words) whose word sense an earlier turn in the same conversation could pull wrong, each with a `mustNotMatch` for the wrong sense. Copy the documented "Đánh một cái seri lớn… resort…" case into `anchoring-control.example.jsonl` as the template.
- Verify: `node -e 'const r=require("fs").readFileSync("benchmarks/conversation-context/data/corpus.jsonl","utf8").trim().split("\n").map(JSON.parse);process.exit(r.every(x=>typeof x.reference==="string"&&x.reference.trim())?0:1)'` exits 0.

### Task 5.4 — The runner

- Target: `run.mjs --arm baseline|oracle|digest --repeats 3 --limit-calls <n>`.
- Steps:
  1. Refuse to start (exit 2, no API call) if any row lacks `reference`, if any kept `terms[]` entry has an empty or missing `mustMatch`, if any anchoring-control row lacks `mustNotMatch`, if `--limit-calls` is missing, or if `rows × repeats > --limit-calls`. (`scoreRow` throws on a missing `mustMatch`, so this must fail before money is spent.) Print the planned call count first.
  2. Build the translator with `makeTranslationProvider` / `takeProviderArgs` from `benchmarks/translation-providers.mjs` and `--provider deepseek` (the preset already carries `thinking: disabled` and the key handling; `benchmarks/prompt-injection/run.mjs` uses it the same way). Key from env `DEEPSEEK_API_KEY` (pass it as `DEEPSEEK_API_KEY="$(docker exec chatofy_prod_api printenv OPENAI_COMPATIBLE_API_KEY)"`, never echoed).
  3. Walk each conversation in `pos` order. Per turn send `context` = the last 4 earlier finished sources in the same language (what `ConversationContext.recall` gives) and `purpose: 'final'`.
  4. Arm `baseline`: no conversation hints. Arm `oracle`: hints built from the user's data, as the digest WOULD have known it at that turn, and injected under the SAME rules Phase 06 will ship, so the oracle measures the design and not a looser one:
     - glossary pairs = the `terms` whose source already occurred in an earlier turn AND occurs in this turn's source (compare with `foldForMatch` from `@chatofy/ai-providers`), rendered as the user's reference rendered them; at most 24, each side ≤ 4 words;
     - `topic` = the conversation's `domain`, ONLY when this turn's source has ≤ 4 words (count with `countTermWords` from `@chatofy/types`; this is today's `needsPriorSpeech` rule in `prompt-builder.ts` ~L400, which is not exported, so restate it in one commented line), otherwise no topic. Today `buildContextBlock` writes `Subject:` into every prompt it receives, so the gate must be applied before the hints are passed.
       Pass them through the `TranslationHints` fields the app sends (`topic`, `glossary`). Arm `digest`: reserved for Phase 07 (exit 2 with a message until then).
  5. Write `results/<arm>-r<k>/rows.jsonl` (gitignored) with `hypothesis` per row.
- Verify: `node benchmarks/conversation-context/run.mjs --arm baseline --repeats 1 --limit-calls 1` exits 2 and prints a planned count > 1 (the refusal works).

### Task 5.5 — The scorer

- Target: `score.mjs <baselineDir…> <armDir…>`: term-render accuracy (via `scoreRow` from `benchmarks/error-analysis/term-rendering.mjs` over the `terms` entries), overall and per bucket; chrF++ per row (call `score-adequacy.py` or reuse its chrF code); paired bootstrap of the per-row arm − baseline deltas (10,000 resamples, seed fixed) giving the mean and 95% CI; anchoring-control flips (`mustNotMatch` hits) per arm.
- `score.test.mjs`: a 4-row fixture where the arm fixes one term → term accuracy delta = +0.25, and bucket split is correct.
- Verify: `node --test benchmarks/conversation-context/score.test.mjs` exits 0.

### Task 5.6 — Oracle run and the go/no-go for the digest

- Steps: run `baseline` and `oracle` at `--repeats 3`, each with `--limit-calls` equal to its planned count (the plan-wide cap is 3,000 DeepSeek-direct calls; record the running total in the report). Then score.
- Pass condition (GO): oracle term-render CI excludes 0 with a positive mean, AND oracle gain in bucket 16+ ≥ gain in bucket 1–5, AND anchoring flips oracle ≤ baseline.
- If NO-GO: Phase 06–07 are cancelled. Write the negative result into the report and into `docs/development-journey.md` as a dated entry (what was measured, the numbers, why the digest was not built), then tell the user. This is a valid outcome, not a failure.
- Verify: the report contains `GO` or `NO-GO` on its own line, followed by the three numbers that decided it.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:

- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
  Apply kongming's guidance, then re-run the Verify step.
  If `kongming` cannot be spawned in this environment, STOP and report the same
  failure evidence to the user. Never continue by self-reasoning.
