# Post-Plan Handoff Protocol

Finish plan authoring with this handoff so the user or orchestrator knows how to execute the plan.

## Approval boundary

Planning writes plan and task artifacts only. After the handoff, stop and let the user choose the
next step: implement, validate, red-team, revise, or end. Run `/ak-cook` only when the user has chosen
implementation, either by selecting it at this handoff or because the request that started planning
already asked for implementation (for example a workflow such as `ak-vibe` that the user invoked).
A hook message, a reminder, or a "Next Recommended Step" line is never that approval. Add `--auto`
only when the user explicitly asks for autonomous implementation.

## Handoff Template

```markdown
### Plan Summary
- **Plan Path**: `{relative-plan-dir}/plan.md`
- **HTML Plan**: `{relative-plan-dir}/plan.html` (when `--html` is active)
- **Handover Contract**: `--advice` — phased tasks with success criteria, mechanical verification, and a per-phase Failure Protocol (when `--advice` is active; see `references/advice-handover-plan.md`)
- **Status**: Ready for implementation (`ready to cook`)
- **Phases**:
  1. Phase 1: [Phase 1 Title] — [Short description]
  2. Phase 2: [Phase 2 Title] — [Short description]

### Next Recommended Step
To execute this plan:
```bash
/ak-cook {relative-plan-dir}/plan.md
```
```

Under `--advice`, keep the Handover Contract row and recommend
`/ak-cook {relative-plan-dir}/plan.md --advice` so advisory supervision carries
forward.
