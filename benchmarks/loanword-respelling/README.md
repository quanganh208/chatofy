# Loanword respelling ruler

Whether the display respells the English words the Vietnamese recognizer garbles, and only those. Examples: "deep fred" becomes "deepfake", and "vnei" becomes "VNeID".

It runs the shipped pieces end to end, so a number here describes production:

- the structural detector (`foreignSpans`);
- the "already spelled as heard" filter (`unresolvedSpans`);
- the respelling prompt on the production host;
- the guards (`acceptRespellings`).

```bash
pnpm --filter @chatofy/ai-providers build      # the ruler loads the built package
node benchmarks/loanword-respelling/score.mjs --repeats 3
```

The script takes `DEEPSEEK_API_KEY` from the environment, falling back to `apps/api/.env`. It never prints the key. In non-thinking mode the host pins `temperature` to 1.0, so a single run proves less than it looks. Use `--repeats`.

## Data

`data/` is gitignored, because the turns are production transcripts.

- `data/turns.json` holds `[{ "id", "src", "en" }]`. It is a read-only dump of `ConversationTurn` joined to `Conversation`, filtered on `'vi' = any("sourceLanguages")`, with `src` = `sourceText` and `en` = `translations->>'en'`.
- `data/truth.json` maps each span (lowercased) to the intended spelling, or `null` when the span is already right. The spellings were adjudicated by hand from the translation and the topic of each conversation, not from the audio.
- A span with no entry is reported as `unjudged`.

## Recorded

2026-10-07, 50 turns from 10 conversations:

|                      | right | wrong | kept | missed |
| -------------------- | ----- | ----- | ---- | ------ |
| per run, 3 of 3 runs | 9     | 1     | 1    | 1      |

- **Wrong:** "Principle singtin" became "First principle", where "principle thinking" was meant. It passes the guards because the translation says "First principle thinking".
- **Missed:** "Amode" (Amodei). Nothing was accepted for it, so it is a safe miss.
- **Kept:** "hecta", which is right as written in Vietnamese. It goes to the model because the translation writes "hectares", and nothing comes back.
- **Not called:** every correct loanword the translation already spells as heard (openai, internet, interpol, podcast, deadline, video). Those spans never reach the model.

### Why the model sees the translation

The same prompt without the translation scored 7 right. It invented "Joseph Pengo" for "Joshua Bengio" and "Amodei" for "Altman". So the call runs after the translation, not beside it.

On that host the call measured p50 599 ms and p90 894 ms over 42 calls. That cost lands only on the ~18% of turns that hold an unresolved span.
