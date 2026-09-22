# Translation Error Taxonomy

40 rows · 36 with a difference · 4 exact

Model: `deepseek-flash`

## Automatic categories

| Category            | Count | Share of errors | Severity |
| ------------------- | ----- | --------------- | -------- |
| lexical-or-semantic | 28    | 77.8%           | medium   |
| casing-punctuation  | 8     | 22.2%           | low      |

## What each one says to do

- **lexical-or-semantic** — The words genuinely differ. Label it by hand (geographic, factual, register, homophone) — string comparison cannot tell you which.
- **casing-punctuation** — Cosmetic only. Usually not worth a prompt change.

## Hand-written labels

None. Semantic categories — geographic, factual, register — cannot be
derived from the strings and stay invisible until someone labels the rows.

28 row(s) landed in `lexical-or-semantic` with no label. That
category is a holding pen, not a finding: until those are labelled by hand the
report cannot say what kind of wrong they are.

## One example per category

- `lexical-or-semantic` — ref "The thesis defense committee meets at two this afternoon"
  got "This afternoon the thesis defense committee meets at two o'clock."
- `casing-punctuation` — ref "I have my thesis defense next week"
  got "I have my thesis defense next week."
