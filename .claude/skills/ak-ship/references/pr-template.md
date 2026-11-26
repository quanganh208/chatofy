# PR Body Template

Use this template when creating or updating PRs via `gh pr create` / `gh pr edit`.

Render **headings and prose** in the writing language resolved in
`ship-workflow.md` Step 12. Keep the PR **title** as English conventional commits.

## Template (English headings — localize when language ≠ en)

```markdown
## End-to-end work summary
<facts from task/issue/plan → implement → verify → review → ship>
<mark inferences explicitly; omit steps that did not run>

## Subagent delegation
- Count: <N>
- <role>: <task> — <status> — <result>
<or "None.">

## Technical decisions
- <decision> — <rationale/evidence>
<or "None.">

## Deviations from plan
- <deviation> — <why> — <impact>
<or "No plan." / "No deviations.">

## Completion evidence
- Acceptance: <criterion> → <evidence>
- Tests: <command/result or "skipped: reason">
- Review: <outcome>
- CI: <status or "pending">
- UI screenshots: <links or "N/A (non-UI)" or "Unavailable: reason">
- Changes: <git diff --stat summary>

## Checklist
- [x] <completed item>
- [ ] <incomplete/skipped item> — reason: <why>

## Human actions required
<None or concrete human follow-ups>

## Linked Issues
- Closes #XX — <issue title>
- Relates to #YY — <issue title>
<or "No linked issues.">

## Ship Mode
- Mode: <official|beta>
- Target: <target-branch>
- Writing language: <tag> (source: <source>; fallback: <reason or none>)
```

## Vietnamese heading map (`language: vi`)

| English | Vietnamese |
|---------|------------|
| End-to-end work summary | Tóm tắt công việc end-to-end |
| Subagent delegation | Ủy thác subagent |
| Technical decisions | Quyết định kỹ thuật |
| Deviations from plan | Lệch so với plan |
| Completion evidence | Bằng chứng hoàn thành |
| Checklist | Checklist |
| Human actions required | Việc cần người xử lý |
| Linked Issues | Issues liên quan |
| Ship Mode | Chế độ ship |

## Notes

- Evidence-backed only: use `None` / `Not run` / `Unavailable` instead of inventing narrative
- Preserve `Closes #N` keywords exactly
- UI/UX PRs need real screenshots or an explicit unavailable reason
