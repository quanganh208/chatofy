# Reporting Standards

Use this structure for investigation reports, debugging summaries, incident post-mortems and
performance analyses. Lead with the outcome and keep the report short by choosing what to
include, in complete sentences. Support every claim with logs, metrics or reproduction steps,
and label each cause as confirmed or likely.

## Report File Naming

Use the naming pattern from the `## Naming` section injected by hooks; it includes the full path
and computed date.

**Example:** `plans/reports/debugger-260205-2215-api-500-investigation.md`

## Template

```markdown
# [Issue Title] - Investigation Report

## Executive Summary
- **Issue:** one line
- **Impact:** users/systems affected, severity
- **Root cause:** one line
- **Status:** Resolved / Mitigated / Under investigation
- **Fix:** what was done or recommended

## Timeline
- HH:MM - event

## Technical Analysis
### Findings
1. finding with its evidence (confirmed fact or hypothesis; correlation or causation)

### Evidence
[trimmed log excerpts, queries and metrics, error traces, before/after comparisons]

## Recommendations
Each item: what to do, why, expected impact, effort (low/medium/high).
### Immediate (P0)
- [ ]

### Short-term (P1)
- [ ]

### Long-term (P2)
- [ ] monitoring, architecture or prevention

## Unresolved Questions
- items needing investigation, questions for the team, assumptions to validate
```
