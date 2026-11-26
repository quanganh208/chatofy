# Codebase Scan Workflow

Scan and review the codebase for: <tasks>$ARGUMENTS</tasks>

Requested scope is a constraint, not a finding; flag only additions beyond the request.
Raise genuinely unsafe or redundant requested scope as a question with evidence, never as
a cut. With `--yagni`, scope-cut recommendations are also in scope.

1. Map the codebase with `/ak-scout`. Split review across `code-reviewer` agents only when
   the codebase is large enough that independent areas can be reviewed separately.
2. Verify each accepted finding against current source before reporting it.
3. When findings warrant a fix program, hand them to `/ak-plan` to write `plan.md`
   with `phase-XX-phase-name.md` phase files.
4. Report findings with evidence, the plan location if one was written, next steps and
   unresolved questions. Ask before committing or pushing anything.
