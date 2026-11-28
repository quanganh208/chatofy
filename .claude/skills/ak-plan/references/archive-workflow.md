# Archive Workflow

Journal and archive specific plans, or all plans in the `plans` directory.

## Plan Resolution
1. If `$ARGUMENTS` provided → Use that path
2. Else read all plans in the `plans` directory

## Workflow (in order)

1. **Read** each `plan.md` and the first 20 lines of each `phase-*.md` to learn progress and status.
2. **Journal** with `/ak-journal`. Apply the shared "Journal step — opt-out" block in SKILL.md first: when it skips, print its one-line notice and go to step 3 without asking. Otherwise ask via `ask_user capability` whether to write journal entries; on "Yes", delegate to `journal-writer` agents (delegate_agent capability, `subagent_type="journal-writer"`) in parallel, one per plan. Entries go in `./plans/journals/`, stay concise (key events, changes, impacts, decisions), and serve as chronological records; durable rules belong in current docs or ADRs.
3. **Confirm** via `ask_user capability`: archive these plans, select specific plans, or archive only completed plans.
4. **Archive** by changing index visibility, never by touching files:
   - Run `ak plan archive <plan-dir>` (and/or `ak plan cleanup` for a retention
     sweep of stale closed plans — dry-run by default). Run `ak plan --help` and
     each subcommand's `--help` for exact flags; those live surfaces own syntax.
   - These mark the plan closed/archived in the rebuildable index. They do not
     move or delete the `plan.md`/`phase-*.md` files, which are canonical repo
     history.
   - Never offer or run `rm -rf` or any permanent delete of a plan folder. Physically
     removing a plan folder is a separate, explicit user action only, after the
     plan is archived in the index, journaled, and committed: the user runs
     `git rm -r ./plans/<plan-dir>` themselves, because `git rm` refuses untracked
     paths and preserves history, while `rm -rf` on a gitignored `plans/` is
     unrecoverable. Never a skill default, never a broad-glob delete.
   - If `ak` is unavailable, report the skip and leave the files untouched; do not
     hand-move plans into an `./plans/archive` directory.
5. **Commit?** Ask via `ask_user capability`: stage and commit (`/ak-git` commit flow), commit and push (`/ak-git` push flow), or "Nah, I'll do it later".

## Output
- Number of plans archived (index visibility only; files kept on disk)
- Table of plans that are archived (title, status, created date, LOC)
- Table of journal entries that are created (title, status, created date, LOC)
- Unresolved questions, if any
