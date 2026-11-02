# Conversation context

Does knowing what a conversation is about help `deepseek-flash` translate its later turns?

This benchmark answers that before any digest code exists. It translates real conversations turn by turn, in spoken order. It scores each turn against a reference the user wrote, comparing two arms:

- `baseline`: what prod sends today. That is the turn plus its last four same-language utterances as `context`; the provider drops that context from a turn longer than four words.
- `oracle`: the same, plus the conversation state a perfect digest would have held at that turn, built from the user's own corpus. It is injected under the rules the shipped digest must follow (`oracleHints` in `run.mjs`):
  - **Glossary:** a term is offered only when an earlier turn said it and this turn says it too. It is rendered as the user rendered it, with at most 24 pairs and at most four words on each side.
  - **Topic:** the conversation's `domain` reaches only a turn of at most four words. A complete sentence can be pulled to the wrong word sense by it; `prompt-builder.ts` documents the case above `MAX_FRAGMENT_WORDS`.

A third arm, `digest`, is reserved for the real digest and is refused until it exists.

## Steps

1. **Build the packages** the scripts import: `pnpm --filter @chatofy/ai-providers... build`.
2. **Export draft rows** from prod. This is read-only, through `docker exec chatofy_prod_postgres psql`:

   ```bash
   node benchmarks/conversation-context/export-turns.mjs --owner <userId> --conv <clientId,clientId>
   ```

   It writes `data/corpus.jsonl` and `data/conversations.jsonl`; both are gitignored. It refuses to overwrite a corpus that already holds a written reference unless given `--force`.

3. **Finish the corpus by hand.** Model-written references are not allowed, because they would score the model against itself.
   - In `corpus.jsonl`, fill every `reference`. `draft` is the prod translation, given only as a hint.
   - `terms` are suggestions: capitalised runs that an earlier turn already said. Delete the wrong ones and add any that were missed. For each kept term, write:
     - `target`: how the reference renders it;
     - `mustMatch`: a regex source, no flags, that a correct output must match.
   - Add at least 10 anchoring-control rows: complete sentences of 5 or more words whose word sense an earlier turn could pull wrong. Each has `"control": "anchoring"` and a `mustNotMatch` for the wrong sense. `anchoring-control.example.jsonl` is the template, made from the documented "Đánh một cái seri lớn… resort…" case.
   - In `conversations.jsonl`, write a `domain` of at most four words for each conversation.

4. **Run.** Each run spends one paid DeepSeek call per row per repeat. It prints the planned count, then refuses (exit 2, no call made) if the corpus is unfinished or the count is above `--limit-calls`.

   ```bash
   DEEPSEEK_API_KEY="$(docker exec chatofy_prod_api printenv OPENAI_COMPATIBLE_API_KEY)" \
     node benchmarks/conversation-context/run.mjs --arm baseline --repeats 3 --limit-calls <n>
   DEEPSEEK_API_KEY=… node benchmarks/conversation-context/run.mjs --arm oracle --repeats 3 --limit-calls <n>
   ```

   Results go to `results/<arm>-r<k>/rows.jsonl` (gitignored).

   **Terms-only corpus.** The verdict below reads only term accuracy and anchoring flips, not the references. A corpus with no `reference` can still run with `--terms-only`, which skips the reference check. Score it with `--no-chrf`. Its terms, controls and domains must still be finished, and a reference, when present, must still be a person's words.

5. **Score.** This needs `uv`; sacrebleu is fetched on demand for chrF++. Pass `--no-chrf` to skip it.

   ```bash
   cd benchmarks/conversation-context
   node score.mjs --baseline results/baseline-r1,results/baseline-r2,results/baseline-r3 \
     --arm results/oracle-r1,results/oracle-r2,results/oracle-r3
   ```

## What the score means

- Each turn is averaged over its repeats, then arm and baseline are compared as paired per-turn deltas. A paired bootstrap gives the interval: 10,000 resamples with a fixed seed. DeepSeek pins `temperature` to 1.0 with thinking off, so only repeats separate a real difference from sampling noise.
- **Term accuracy** is `scoreRow` from `error-analysis/term-rendering.mjs`, applied to every kept term. It is reported overall and per position bucket: turns 1–5, 6–15 and 16+ of their conversation.
- **chrF++** is computed per turn against the reference by sacrebleu, the same metric `live-translate` reports.
- **Anchoring flips** count the control turns whose output matched `mustNotMatch`.

The last block prints `GO`, `NO-GO` or `UNDECIDED` on its own line, followed by the three numbers that decided it. `GO` needs all three of these:

- the term gain's 95% CI lies above zero;
- turns 16+ gain at least as much as turns 1–5;
- the oracle flips no more anchoring controls than the baseline does.

`NO-GO` means a perfect conversation state does not help this model, and the digest is not built.

## Tests

```bash
node --test benchmarks/conversation-context/*.test.mjs
```
