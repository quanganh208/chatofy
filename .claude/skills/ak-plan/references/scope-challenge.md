# Step 0: Scope Challenge

Run before research or design.

## Skip Conditions

Skip Step 0 when the task is clearly trivial (single file fix, typo, config
change), the user signals urgency ("just plan it", "quick"), or the request is
short and unambiguous.

When Step 0 is skipped, preserve the full requested scope. Only `--yagni` or a
direct user instruction to cut a named item authorizes scope reduction.
`--fast` changes planning depth only and is not a skip condition here.

## The 3 Questions

1. **What already exists?** Code, utilities, or patterns that partly or fully
   solve sub-problems; flag any plan that would rebuild them.
2. **What did the user actually ask for?** Restate the requested scope; it is
   the baseline the plan must deliver in full. Flag additions beyond the request
   that crept in during analysis. Note deferrable work only as information for
   the user's choice below; do not defer anything on your own.
3. **Complexity check:** more than 8 files, more than 2 new classes/services, or
   more than 3 phases each needs a justification or a simpler alternative.

## Scope Modes

After answering the 3 questions, present this fork via `ask_user capability`
only when the user passed `--yagni`:

**Header:** "Scope Challenge"
**Question:** "Based on analysis, how should we scope this plan?"

| Option | Label | Description |
|--------|-------|-------------|
| A | **SCOPE EXPANSION** | Explore the fuller version, research deeply, add delight features |
| B | **HOLD SCOPE** | Scope is right; focus on execution, edge cases, test coverage |
| C | **SCOPE REDUCTION** | Strip to essentials, defer everything non-blocking, minimal phases |

**`--yagni` passed:** the user has opted into scope-cutting, so REDUCTION is
pre-authorized — present the fork with C as the recommended option instead of
asking neutrally. Still surface EXPANSION if the analysis found scope that is
missing and blocking; the flag authorizes cutting, not skipping the analysis.

**Without `--yagni`:** do not present the scope-mode fork or recommend
reductions. Record `HOLD SCOPE`, reject only unrequested additions, and deliver
the full requested scope.

## After Selection

- **EXPANSION:** suggest `--hard` or `--two`; label stretch items clearly.
- **HOLD:** proceed with the auto-detected mode; no silent reduction or expansion.
- **REDUCTION:** suggest `--fast`; move everything non-critical to a "NOT in
  scope" section.

Raise scope concerns once, here. After the user selects a mode, commit to it and
do not re-argue scope in later review sections.

## Output Format

```
Scope Challenge:
- Existing code: [what was found that's reusable]
- Requested scope: [what the user asked for — delivered in full unless they choose REDUCTION]
- Complexity: [estimated files, new abstractions]
- Selected mode: [EXPANSION/HOLD/REDUCTION]
```
