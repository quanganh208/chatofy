# Translation Error Taxonomy

40 rows · 37 with a difference · 3 exact

## Automatic categories

| Category            | Count | Share of errors | Severity |
| ------------------- | ----- | --------------- | -------- |
| lexical-or-semantic | 31    | 83.8%           | medium   |
| casing-punctuation  | 4     | 10.8%           | low      |
| invention           | 1     | 2.7%            | high     |
| number-mismatch     | 1     | 2.7%            | high     |

## What each one says to do

- **lexical-or-semantic** — The words genuinely differ. Label it by hand (geographic, factual, register, homophone) — string comparison cannot tell you which.
- **casing-punctuation** — Cosmetic only. Usually not worth a prompt change.
- **invention** — The output carries substantially more than the reference — the shape of a completed fragment. Rule 5 is not holding; re-run the fragment cases in benchmarks/prompt-injection.
- **number-mismatch** — The digits changed. Identifiers are read digit by digit downstream, so a wrong one is spoken confidently. Check the number rule in the instruction.

## Hand-written labels

None. Semantic categories — geographic, factual, register — cannot be
derived from the strings and stay invisible until someone labels the rows.

31 row(s) landed in `lexical-or-semantic` with no label. That
category is a holding pen, not a finding: until those are labelled by hand the
report cannot say what kind of wrong they are.

## One example per category

- `lexical-or-semantic` — ref "The thesis defense committee meets at two this afternoon"
  got "This afternoon the review board meets at two o'clock"
- `casing-punctuation` — ref "The cardiology department is on the fourth floor"
  got "The cardiology department is on the fourth floor."
- `invention` — ref "Đề cương chỉ dài hai trang"
  got "Bản phác thảo đề xuất chỉ dài có hai trang."
- `number-mismatch` — ref "Khoa tim mạch mở cửa lúc bảy giờ"
  got "Khoa tim mạch mở cửa lúc 7 giờ."
