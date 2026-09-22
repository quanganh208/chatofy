# Translation Error Taxonomy

40 rows · 36 with a difference · 4 exact

Model: `deepseek-flash`

## Automatic categories

| Category            | Count | Share of errors | Severity |
| ------------------- | ----- | --------------- | -------- |
| lexical-or-semantic | 32    | 88.9%           | medium   |
| casing-punctuation  | 4     | 11.1%           | low      |

## What each one says to do

- **lexical-or-semantic** — The words genuinely differ. Label it by hand (geographic, factual, register, homophone) — string comparison cannot tell you which.
- **casing-punctuation** — Cosmetic only. Usually not worth a prompt change.

## Hand-written labels

None. Semantic categories — geographic, factual, register — cannot be
derived from the strings and stay invisible until someone labels the rows.

32 row(s) landed in `lexical-or-semantic` with no label. That
category is a holding pen, not a finding: until those are labelled by hand the
report cannot say what kind of wrong they are.

## One example per category

- `lexical-or-semantic` — ref "The thesis defense committee meets at two this afternoon"
  got "The defense committee meets at two o'clock this afternoon."
- `casing-punctuation` — ref "I have already submitted my graduation thesis to the academic affairs office"
  got "I have already submitted my graduation thesis to the academic affairs office."
