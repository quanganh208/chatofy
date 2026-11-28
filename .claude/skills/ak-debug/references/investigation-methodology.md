# Investigation Methodology

Structured investigation for server incidents, system behavior that changed without obvious
code changes, and failures spanning services, databases or infrastructure. Work through these
stages in order, because analysis without collected evidence turns into guessing:

1. **Assess** symptoms, affected components, start time, severity, and recent changes
   (deployments, commits, config, dependencies):
   ```bash
   gh run list --limit 10
   git log --oneline -20 --since="2 days ago"
   git diff HEAD~5 -- '*.env*' '*.config*' '*.yml' '*.yaml' '*.json'
   ```
2. **Collect** server and application logs for the window, CI/CD logs (see
   `log-and-ci-analysis.md`), database state and recent migrations, system metrics, and
   external dependency status. For codebase context, follow the repository instructions and
   docs navigation, verify them against current source, tests, configuration and logs, and use
   `/ak-scout` or `/ak-scout ext` when context is missing or conflicting. Use `ak-repomix` only
   when a broad packaged snapshot materially helps; do not generate a mandatory summary
   document. Use `ak-docs-seeker` for package/plugin documentation.
3. **Analyze**: build a timeline across log sources, find patterns (deployment or time
   correlation, intermittent or consistent, all users or a subset), trace the request path,
   and map which components depend on the failing one.
4. **Identify the root cause** by ranking hypotheses by evidence and eliminating them with the
   smallest experiment each. Do not fix the first hypothesis without testing the alternatives;
   consider races, resource limits and config drift. Document the chain from trigger to
   symptom.
5. **Develop the solution** by impact and urgency: restore service first (hotfix, rollback,
   config), then fix the root cause, then add monitoring or validation against recurrence, with
   a plan to verify it in production.

When the investigation narrows to specific code, switch to `systematic-debugging.md`, use
`root-cause-tracing.md` for deep call stacks, consider `defense-in-depth.md` after the fix,
and finish with `verification.md`.
