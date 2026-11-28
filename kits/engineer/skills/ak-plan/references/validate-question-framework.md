# Validation Question Framework

## Question Categories

Architecture, Assumptions, Tradeoffs, Risks, Scope.

## Question Format Rules

- Each question has 2-4 concrete options
- Mark the recommended option with a "(Recommended)" suffix
- "Other" option is automatic
- Questions should surface implicit decisions

## Validation Log Format

```markdown
## Validation Log

### Session {N} — {YYYY-MM-DD}
**Trigger:** {what prompted this validation}
**Questions asked:** {count}

#### Questions & Answers

1. **[{Category}]** {full question text}
   - Options: {A} | {B} | {C}
   - **Answer:** {user's choice}
   - **Custom input:** {verbatim "Other" text if applicable}
   - **Rationale:** {why this decision matters}

#### Confirmed Decisions
- {decision}: {choice} — {brief why}

#### Action Items
- [ ] {specific change needed}

#### Impact on Phases
- Phase {N}: {what needs updating and why}
```

Record the exact question text, every option presented, and "Other" input
verbatim. Number sessions incrementally from the last one.

## Section Mapping for Phase Propagation

| Change Type | Target Section |
|-------------|----------------|
| Requirements | Requirements |
| Architecture | Architecture |
| Scope | Overview / Implementation Steps |
| Risk | Risk Assessment |
| Unknown | Key Insights (new subsection) |
