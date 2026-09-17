# Translation Error Taxonomy

40 rows · 36 with a difference · 4 exact

Model: `gemini-3.5-flash-lite`

## Automatic categories

| Category            | Count | Share of errors | Severity |
| ------------------- | ----- | --------------- | -------- |
| lexical-or-semantic | 29    | 80.6%           | medium   |
| casing-punctuation  | 4     | 11.1%           | low      |
| number-mismatch     | 2     | 5.6%            | high     |
| invention           | 1     | 2.8%            | high     |

## What each one says to do

- **lexical-or-semantic** — The words genuinely differ. Label it by hand (geographic, factual, register, homophone) — string comparison cannot tell you which.
- **casing-punctuation** — Cosmetic only. Usually not worth a prompt change.
- **number-mismatch** — The digits changed. Identifiers are read digit by digit downstream, so a wrong one is spoken confidently. Check the number rule in the instruction.
- **invention** — The output carries substantially more than the reference — the shape of a completed fragment. Rule 5 is not holding; re-run the fragment cases in benchmarks/prompt-injection.

## Hand-written labels

None. Semantic categories — geographic, factual, register — cannot be
derived from the strings and stay invisible until someone labels the rows.

29 row(s) landed in `lexical-or-semantic` with no label. That
category is a holding pen, not a finding: until those are labelled by hand the
report cannot say what kind of wrong they are.

## One example per category

- `lexical-or-semantic` — ref "The thesis defense committee meets at two this afternoon"
  got "This afternoon the review board meets at two o'clock."
- `casing-punctuation` — ref "I have already submitted my graduation thesis to the academic affairs office"
  got "I have already submitted my graduation thesis to the academic affairs office."
- `number-mismatch` — ref "The deposit is five million dong"
  got "The deposit is 5 million VND."
- `invention` — ref "Đề cương chỉ dài hai trang"
  got "Đề cương của bản đề xuất chỉ dài có hai trang."
