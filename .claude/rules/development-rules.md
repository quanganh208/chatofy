# Development Rules

Use this file when editing code, tests, scripts, or configuration.

## Baseline

- Follow project docs in `docs/` and existing local patterns.
- Apply KISS and DRY. Deliver the full requested scope — do not trim, defer, or
  simplify away features the user explicitly asked for. Add nothing beyond the
  request. When the user passes `--yagni`, additionally apply YAGNI (You Aren't
  Gonna Need It): challenge and cut any scope not needed for the stated outcome.
- Implement real behavior. Do not add fake data, mocks, or temporary shortcuts just to satisfy a check.
- Keep changes scoped to the request and the affected contracts.
- Use descriptive kebab-case file names for new files when the repo has no stronger convention.
- Split code only when it reduces real complexity or matches existing module boundaries.

## Quality Gates

- Run the narrowest useful test first, then broaden when shared behavior or public contracts changed.
- Do not hide failing tests, lint, type, build, or syntax errors.
- Preserve public contracts unless the change intentionally updates them and the user accepted that scope.
- Keep commits focused and use conventional commit format without AI references.
- Never commit secrets, dotenv files, tokens, private keys, database credentials, or personal data.

## UI review — the one rule with no mechanical gate

**One accent-filled control per app screen.** Count them before calling a screen done:
`bg-primary` fills exactly one control on `/dashboard`, `/translate`, `/preferences`,
`/account`. Everything else is ghost, outline, or a readout.

Everything else in `docs/design-guidelines.md` is enforced by a spec — the skin guards,
the contrast floors, the token parity, the type scale. This rule is not, on app screens,
because "per viewport" is a visual fact. The marketing page IS covered:
`apps/web/src/components/marketing/accent-budget.spec.tsx` allows at most one per section,
which is where sprawl actually happens.

If an accent-sprawl regression ships on an app screen after this, the honest next step is
a spec per screen, not a louder checklist.

## Tooling

- Use `gh` for GitHub operations when needed.
- Use current docs only when the API/tooling may have changed.
- Use relevant skills by reading their descriptions first, then opening only the needed `SKILL.md`.
- Use `/ak:preview` only when a visual explanation will materially help the user understand the change.
