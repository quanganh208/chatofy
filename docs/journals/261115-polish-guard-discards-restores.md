# The polish fixes omissions; its length guard throws the fix away

2026-11-15

- **Run:** 30 known omissions (20 trailing drops, 10 clause omissions) replayed through the prod polisher `gpt-5.6-sol` with context. 30 Command Code calls, $1.78 judge. Commits 7d0282be, 59747b25, 8b2523c9, 1a0300db.
- **Result:** 11 of 27 confirmed survived, so the gate read continue. But all 16 rows the polish was allowed to rewrite were fixed. 10 survivors were restores that the `2 × draft + 40` guard discarded (0 of 10 still hold the omission when judged), and 1 was declined.
- **Why it matters:** the whole decision-model detector idea was aimed at a symptom. A detector plus re-polish would hit the same guard. Measuring the existing pipeline first turned a model problem into a one-line bound.
- **What made it visible:** wrapping `fetch` to keep the raw answer (reading a clone), so a guard rejection could be told apart from a decline. Without it, all 11 would have read as "the model declined".
- **Lessons:**
  - Before adding a model to catch an error, replay the error through the pipeline that already runs, with raw answers kept.
  - A guard sized relative to a possibly broken input (the short draft) punishes exactly the fix it should allow.
  - The ruler confirmed exactly 27/30: the stop-to-ask bar was hit on the boundary, so record it as such.
- **Next:** `plans/reports/brainstorm-261115-1757-polish-length-guard.md`, offline guard measurement, then the app change on the user's call.
