# Checklist-Based Review Workflow

Use for pre-landing review from the ship pipeline, an explicit checklist request, a
pre-release security audit, or a code-reviewer pass over 10+ files or security-sensitive
code.

1. **Load checklists.** Always load `checklists/base.md`. Add `checklists/web-app.md` when
   the project uses a frontend framework (React, Vue, Svelte, Next, Nuxt, Angular) and
   `checklists/api.md` when it exposes routes or controllers; load both when both apply.
2. **Read the whole diff** against the target branch (`git diff origin/<target>`) before
   flagging anything, since a later hunk may already address an earlier one.
3. **Two passes.** Pass 1 checks the blocking categories of every loaded checklist; Pass 2
   checks the informational ones. Every finding carries `[file:line]`, the problem and a
   fix. Blocking findings stop the ship pipeline; informational ones go into the PR body.
4. **Apply the suppressions** at the bottom of `base.md` before reporting.
5. **Report** in the output format from `base.md`. In the ship pipeline, ship's own
   pre-landing step decides how blocking findings are resolved. In a standalone review,
   present each blocking finding with its recommended fix and let the user choose: fix
   now, acknowledge and proceed, or mark a false positive. After a fix, rerun the tests.

Within a standard code review the checklist augments the scout, review, fix and verify
pipeline; merge its findings with the reviewer's own.
