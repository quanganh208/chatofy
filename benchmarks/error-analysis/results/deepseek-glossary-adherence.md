# Glossary adherence

How often an output carried the term the glossary names for a term in its source.

| Arm                  | Model          | Used | Occurrences | Rate  |
| -------------------- | -------------- | ---- | ----------- | ----- |
| deepseek-after.jsonl | deepseek-flash | 42   | 43          | 97.7% |

## Misses, by how many of the 1 arm(s) they appear in

- 1/1 — v14 → prescription

Read these before counting them as failures. An entry whose source side is a NOUN can appear in a sentence that uses the idea as a verb — `kê đơn thuốc` answered by "prescribed medication" is a correct translation and an unavoidable miss here, and it misses identically for every model, which is how it can be told apart from one that got the term wrong.
