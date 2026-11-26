---
name: spec-compliance-review
description: First-pass review checking implementation matches spec/plan requirements before quality review
---

# Spec Compliance Review

Run this before the quality review when a plan or spec defines the work, because
well-written code that misses a requirement is still wrong.

1. Read the plan or phase file and list every requirement and acceptance criterion.
2. Mark each one against the implementation: PASS (present), MISSING, or EXTRA (built
   but not in the spec).
3. Verdict: all met with no unjustified extras is PASS and the quality review follows.
   Any MISSING is FAIL: the implementer fixes it and the spec review reruns. Unjustified
   EXTRA is WARN: raise it with the user rather than removing it.

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 1 | [from spec] | PASS/MISSING/EXTRA | [evidence] |
