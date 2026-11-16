# Omission plan chosen by two --ultra rounds

2026-11-15

- **Question:** where decision models belong in Chatofy after the benchmark (the commits that measured Jev and Gemini Decision 1).
- **Brainstorm --ultra (5 candidates, low margin, 88 vs 85):** do not ship a decision model yet. First measure whether a dropped sentence survives the prod polish at all, then whether a local, no-network check catches it as well as Jev or Gemini.
- **Plan --ultra (85 vs 84):** `plans/261115-1730-omission-survival-and-cheapest-detector/`. The winning plan checked facts against the data that the brief had wrong:
  - 151–154 clean rows already exist, so no new recordings are needed;
  - 16 of the 30 positives are block rows;
  - 8 of the 30 are bound by the polisher's length guard (`2 × draft + 40`), so the guard, not the model, can decide whether a faithful restore survives.
- **User decisions:**
  - Command Code `gpt-5.6-sol`, capped at 60 calls;
  - a new 5% FP bar (7/151);
  - A1 runs before the rest of the rig is built.
- **Lesson:** both --ultra rounds had a low margin. A single pass would likely have produced an equivalent contract and plan. Their value came from the verifier's fact checks, not from the fan-out.
