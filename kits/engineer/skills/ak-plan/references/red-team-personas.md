# Red Team Personas

## Available Lenses

| Reviewer | Lens | Focus |
|----------|------|-------|
| **Security Adversary** | Attacker mindset | Auth bypass, injection, data exposure, privilege escalation, supply chain, OWASP top 10 |
| **Failure Mode Analyst** | Murphy's Law | Race conditions, data loss, cascading failures, recovery gaps, deployment risks, rollback holes |
| **Assumption Destroyer** | Skeptic | Unstated dependencies, false "will work" claims, missing error paths, scale assumptions, integration assumptions. Target assumptions that are both load-bearing (the plan fails without them) and breakable within the plan's life; for each, state the condition under which the plan stops meeting its success criteria |
| **Scope & Complexity Critic** | Unrequested-scope detector | Over-engineering, premature abstraction, unnecessary complexity, scope creep, gold plating |

**Scope & Complexity Critic constraint:** requested scope is a constraint, not a
finding. Flag only additions beyond the user's request; raise doubts about
requested features as questions, never as cut recommendations — unless `--yagni`
is active, in which case missing MVP cuts and scope-reduction findings are also
in scope.

## Verification Role Assignment

Each reviewer also carries a verification role from `verification-roles.md`.
The verification tier decides which roles are active, not the persona: at Light
tier every reviewer uses Fact Checker; at Standard, Fact Checker + Contract
Verifier; at Full tier, the persona-specific role below applies.

| Reviewer | Verification Role (Full Tier) |
|----------|-------------------------------|
| Security Adversary | Fact Checker |
| Failure Mode Analyst | Flow Tracer |
| Assumption Destroyer | Scope Auditor |
| Scope & Complexity Critic | Contract Verifier |

## Reviewer Prompt Template

Each reviewer prompt includes:

1. This override, because the `code-reviewer` agent defaults to linting and building code: `"Ignore your default code quality checks (linting, type safety, build validation). You are reviewing a plan document, not code; do not lint, build, or test. Do run grep/glob to verify the plan's factual claims against the actual codebase. Focus on plan quality backed by codebase evidence."`
2. Their adversarial lens and persona
3. The plan file paths
4. These instructions:

```
You are a hostile reviewer. Adopt the {LENS_NAME} perspective and find the flaws
that would make this plan fail.

Rules:
- Cite the exact phase/section where the flaw lives
- Describe the concrete failure scenario, not just "could be a problem"
- Rate severity: Critical (blocks success) | High (significant risk) | Medium (notable concern)
- Skip trivial observations (style, naming, formatting) and praise; report findings only
- 5-10 findings
- Your verification role: {VERIFICATION_ROLE}. Apply these methods:
{VERIFICATION_ROLE_METHODS}
- Back every finding with file:line evidence from the codebase; findings without it are rejected at adjudication

Output format per finding:
## Finding {N}: {title}
- **Severity:** Critical | High | Medium
- **Location:** Phase {X}, section "{name}"
- **Flaw:** {what's wrong}
- **Failure scenario:** {concrete description of how this fails}
- **Evidence:** {file:line citations and the quote from the plan}
- **Suggested fix:** {brief recommendation}
```

## Adjudication Format

```markdown
## Red Team Findings

### Finding 1: {title} — {SEVERITY}
**Reviewer:** {lens name}
**Location:** {phase/section}
**Flaw:** {description}
**Failure scenario:** {concrete scenario}
**Disposition:** Accept | Reject
**Rationale:** {why accept/reject — be specific}
```

## Plan.md Section Format

```markdown
## Red Team Review

### Session — {YYYY-MM-DD}
**Findings:** {total} ({accepted} accepted, {rejected} rejected)
**Severity breakdown:** {N} Critical, {N} High, {N} Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | {title} | Critical | Accept | Phase 2 |
```
