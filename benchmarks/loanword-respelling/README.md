# Loanword respelling ruler

Whether the display respells the English words the Vietnamese recognizer garbles, and only those. Examples: "deep fred" becomes "deepfake", and "vnei" becomes "VNeID".

It runs the shipped pieces end to end, so a number here describes production:

- the structural detector (`foreignSpans`);
- the "already spelled as heard" filter (`unresolvedSpans`);
- the respelling prompt on the production host;
- the guards (`acceptRespellings`).

```bash
pnpm --filter @chatofy/ai-providers build      # the ruler loads the built package
node benchmarks/loanword-respelling/score.mjs --repeats 3              # English translations
node benchmarks/loanword-respelling/score.mjs --repeats 3 --target zh  # Chinese translations
```

The script takes `DEEPSEEK_API_KEY` from the environment, falling back to `apps/api/.env`. It never prints the key. In non-thinking mode the host pins `temperature` to 1.0, so a single run proves less than it looks. Use `--repeats`.

## Data

`data/` is gitignored, because the turns are production transcripts.

- `data/turns.json` holds `[{ "id", "src", "en", "zh" }]`. It is a read-only dump of `ConversationTurn` joined to `Conversation`, filtered on `'vi' = any("sourceLanguages")`, with `src` = `sourceText` and `en`/`zh` = `translations->>'en'`/`'zh'`. Production held only one vi→zh conversation (6 turns), so the other turns' `zh` was made by translating `src` with the production translator (`deepseek-flash`, the shipped prompt) and converting it to Simplified, as production does. A turn without a translation into `--target` is skipped.
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

## Chinese translations (2026-10-13)

A Chinese translation writes "Bulgaria" as 保加利亚, so it can never hold a Latin spelling, and the guard refused every proposal for a vi→zh conversation. Production showed "Bungary", "Inche" and "MATA" on such a conversation while each call was still being paid for.

So when a turn's only translation is in Han characters, the model is also asked for the words of the translation that render each span (`LOANWORD_RESPELLING_INSTRUCTION_HAN`). Those words must hold Han characters, be at most 12 characters long, and appear in the translation once both are in Simplified characters. The spelling is still held to every other guard, the letter similarity included. Two fixes came out of measuring it:

- A name kept in Latin letters inside Chinese ("OpenAI的AI模型") was one run of letters with the characters around it, so "OpenAI" was never found in the translation. Han characters now only separate words when the translation is searched for a spelling.
- The model sometimes copies a name in Traditional characters from a Simplified translation, so the rendering is compared after both are converted.

56 turns (50 with a synthesized `zh`, 6 from production), 3 runs:

| `--target` | right | wrong | missed | calls |
| ---------- | ----- | ----- | ------ | ----- |
| zh, before | 0     | 0     | 15     | 22    |
| zh, after  | 8–11  | 2     | 2–5    | 19    |
| en, after  | 9     | 1     | 1      | 9     |

The zh range is the 1.2 s ceiling: an answer with renderings is about twice as long, and 6 of 57 calls missed it in one session. A missed call keeps the line as it was.

- **zh, right:** ammon → Altman, joshup pengo → Joshua Bengio, vnei and vini → VNeID, opena → OpenAI, deep fred and defec → deepfake, inche → Incheon, Bungary → Bulgaria (twice), mata → Malta.
- **zh, wrong:** "opera Dario" → "OpenAI", which drops "Dario", and "Principle singtin" → "First Principles", the same miss as on English.
- **en** is the recorded result above, unchanged: a turn that has a Latin translation is asked exactly as before.
- **Not learned.** A rendering proves the translation names something where the span is, not which word: a review found that a rendering of "总理" or "的" would attest any spelling close in letters. So a rendering must be at least two Han characters, and a spelling accepted only on one is shown on its line but never becomes a hotword (`attestedInLetters`). What holds it to the speaker is the letter similarity to what was heard.
