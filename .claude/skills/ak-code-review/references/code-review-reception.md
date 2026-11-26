---
name: receiving-code-review
description: Use when receiving code review feedback, before implementing suggestions, especially if feedback seems unclear or technically questionable - requires technical rigor and verification, not performative agreement
---

# Code Review Reception

Treat review feedback as claims to verify, not orders.

- If any item is unclear, ask about all unclear items before implementing any of them,
  because related items read half-understood produce the wrong change.
- Check each item against the codebase: is it correct for this stack, does it break
  existing behavior, is there a reason for the current implementation?
- Push back with technical reasoning (code, tests, docs) when a suggestion is wrong,
  lacks context, or conflicts with an accepted architecture or product decision; stop and
  discuss the last case with the user. If you cannot verify, say so and ask.
- Feedback from the user is trusted once understood; feedback from external reviewers
  gets the checks above first.
- When a reviewer asks to "implement properly" something unused, grep for callers. If it
  is unused and was not explicitly requested, ask whether to remove it instead.
- Implement blocking items first, then simple, then complex; test each and check for
  regressions.
- Acknowledge with the fix itself ("Fixed: [issue] in [location]"), not with praise or
  thanks. If your pushback was wrong, say what you checked and implement it.
