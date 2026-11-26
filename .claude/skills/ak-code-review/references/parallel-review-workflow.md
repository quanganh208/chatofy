# Parallel Review Workflow

List the edge cases the scope can hit, then dispatch parallel `code-reviewer` agents to
verify each group: <scope>$ARGUMENTS</scope>

1. **Enumerate.** Use `/ak-scout` and the repository's docs to find the relevant files,
   confirming doc claims against source. List edge cases per scope area (boundaries, error
   paths, concurrency, input validation, trust boundaries, resource lifetime, untested
   paths) with the files each touches.
2. **Assign.** Group them into at most 6 categories, one `code-reviewer` per category.
   Each reviewer gets its list to verify, not to discover, plus the relevant files.
3. **Verify in parallel.** Each reviewer reports every edge case as handled, unhandled or
   partial, with `file:line`.
4. **Aggregate and check.** Report totals and an unhandled table
   (`# | Edge Case | File | Status`). Re-check each blocking finding for a concrete
   file/line and reproduction path, and classify findings Accept / Reject / Defer.
5. **Offer fixes.** If unhandled or partial cases remain, ask: "Found N unhandled edge
   cases. Fix with /ak-fix --parallel? [Y/n]". After fixes, ask before committing
   ("Commit? [Y/n]" via `git-manager`).
