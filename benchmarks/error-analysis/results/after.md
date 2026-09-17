# Translation Error Taxonomy

40 rows · 35 with a difference · 5 exact

## Automatic categories

| Category            | Count | Share of errors | Severity |
| ------------------- | ----- | --------------- | -------- |
| lexical-or-semantic | 25    | 71.4%           | medium   |
| casing-punctuation  | 9     | 25.7%           | low      |
| number-mismatch     | 1     | 2.9%            | high     |

## What each one says to do

- **lexical-or-semantic** — The words genuinely differ. Label it by hand (geographic, factual, register, homophone) — string comparison cannot tell you which.
- **casing-punctuation** — Cosmetic only. Usually not worth a prompt change.
- **number-mismatch** — The digits changed. Identifiers are read digit by digit downstream, so a wrong one is spoken confidently. Check the number rule in the instruction.

## Hand-written labels

None. Semantic categories — geographic, factual, register — cannot be
derived from the strings and stay invisible until someone labels the rows.

25 row(s) landed in `lexical-or-semantic` with no label. That
category is a holding pen, not a finding: until those are labelled by hand the
report cannot say what kind of wrong they are.

## One example per category

- `lexical-or-semantic` — ref "The thesis defense committee meets at two this afternoon"
  got "This afternoon the thesis defense committee is meeting at two o'clock."
- `casing-punctuation` — ref "I have already submitted my graduation thesis to the academic affairs office"
  got "I have already submitted my graduation thesis to the academic affairs office."
- `number-mismatch` — ref "The deposit is five million dong"
  got "The deposit is 5,000,000 VND"
