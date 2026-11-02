---
title: 'Planned vi-en review arms: the polisher runs without context'
date: 2026-11-02
---

# Planned vi-en review arms: the polisher runs without context

The ruler showed vi→en carries the translation errors (23.7% of turns serious mt). Reading the code found the live polisher already asks to fix mistranslations but both call sites in translation-session.service.ts omit `context`, so its <context> block is always empty — the exact thing the judge needed to read "Ai" as AI.

Plan plans/261102-2107-vi-en-polish-review-with-context: replay arms (stored / polish no context / polish with context / optional critique-then-rewrite) on the 162 judged turns with deepseek-v4-pro, judge each with the same calibrated Claude judge, paired bootstrap against the stored baseline, en→vi guard, CometKiwi witness. Ship the context change only on a GO, then confirm on gpt-5.6-sol after Command Code reopens 2026-11-04.

Watch: the DeepSeek key holds $1.46 and also serves prod translation while Command Code is spent — the rig caps its spend and refuses under $1.00. Stored drafts may already be polished (unrecorded), so gains are a conservative estimate.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
