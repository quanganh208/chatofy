# Red Team Review

Adversarially review an implementation plan with parallel reviewer subagents, each holding a different hostile lens and no view of this conversation. You adjudicate the findings; the user decides which to apply.

## Plan Resolution

1. If `$ARGUMENTS` provided → Use that path
2. Else check `## Plan Context` section → Use active plan path
3. If no plan found → Ask user to specify path or run `/ak-plan` first

## Workflow (in order)

1. **Read** `plan.md` and every `phase-*.md` in full.
2. **Scale reviewers** by phase count, using the lenses in `red-team-personas.md`:

   | Phase Count | Reviewers | Lenses Selected |
   |-------------|-----------|-----------------|
   | 1-2 phases | 2 | Security Adversary + Assumption Destroyer |
   | 3-5 phases | 3 | + Failure Mode Analyst |
   | 6+ phases | 4 | + Scope & Complexity Critic (all lenses) |

3. **Spawn reviewers** simultaneously via delegate_agent capability with `subagent_type: "code-reviewer"`, each built from the reviewer prompt template in `red-team-personas.md` with the plan file paths so they read the originals.
4. **Collect**: deduplicate overlapping findings, sort by severity (Critical → High → Medium), and cap at 15.
5. **Evidence filter**: a finding whose `Evidence:` field has no `file:line` citation (pattern `path/to/file.ext:NNN`) is set to **Reject** with rationale "No codebase evidence." without evaluating its merit.
6. **Adjudicate** each remaining finding as **Accept** or **Reject**, with a specific evidence-based rationale.
7. **User review** via `ask_user capability`: "Looks good, apply accepted findings" | "Let me review each one" | "Reject all, plan is fine". For "Let me review each one", ask per accepted finding: "Yes, apply" | "No, reject" | "Modify suggestion"; for a modification, record the user's free text and set the disposition to "Accept (modified)".
8. **Apply** accepted findings to the target phase files inline with a marker, and add the `## Red Team Review` section to `plan.md`.
9. **Sweep** with the Whole-Plan Consistency Sweep in `verification-roles.md`, appended to `## Red Team Review`.

## Output
- Total findings by severity
- Accepted vs rejected count
- Files modified
- Whole-plan consistency sweep results
- Key risks addressed

## Next Steps
Remind user they can run `/ak-plan validate {plan-directory-path}` before implementation.
When the user approves implementation, run `/ak-cook {ABSOLUTE_PATH_TO_PLAN_DIR}/plan.md`.
Add `--auto` only when the user explicitly asks for autonomous implementation.
