# Validate Workflow

Interview the user with critical questions to validate assumptions, confirm decisions, and surface potential issues in an implementation plan before coding begins.

## Plan Resolution

1. If `$ARGUMENTS` provided → Use that path
2. Else check `## Plan Context` section → Use active plan path
3. If no plan found → Ask user to specify path or run `/ak-plan --hard` first

## Configuration

Check `## Plan Context` section for validation settings:
- `mode` - Controls auto/prompt/off behavior
- `questions` - Range like `3-8` (min-max); fewer is fine for a simple plan

## Workflow (in order)

1. **Read** `plan.md` and every `phase-*.md`; note decision points, assumptions, risks, and trade-offs.
2. **Verify** plan claims per `verification-roles.md` at the tier for the plan's phase count, then try to resolve planner-tagged `[UNVERIFIED]` claims. If `plan.md` already has a `## Red Team Review` with verification evidence, only resolve remaining `[UNVERIFIED]` tags. Never auto-correct plan files: every FAILED claim becomes an interview question, with a search-suggested alternative as the "(Recommended)" option. Append the Verification Results block to `## Validation Log`.
3. **Ask** via `ask_user capability`, using the categories and question format in `validate-question-framework.md`. Ask only about genuine decision points that could change implementation; group related questions (max 4 per call).
4. **Record** answers in `## Validation Log` in `plan.md` using the format in `validate-question-framework.md`.
5. **Propagate** decisions to affected phase files with the marker `<!-- Updated: Validation Session N - {change} -->`.
6. **Sweep** with the Whole-Plan Consistency Sweep in `verification-roles.md`, appended to the current `## Validation Log`.

## Output
- Number of questions asked
- Key decisions confirmed
- Phase propagation results
- Whole-plan consistency sweep results
- Recommendation: proceed or revise

## Next Steps

Present next steps with the absolute plan path, since a fresh session (recommend
`/clear` before implementing) has no planning context:

```
/ak-cook {ABSOLUTE_PATH_TO_PLAN_DIR}/plan.md
```

If Verification Results show `Failed: 0`, the plan is eligible for implementation; ask the user before proceeding. Add `--auto` only when the user explicitly asks for autonomous implementation. If `Failed: N > 0`, revise the plan before cooking.
