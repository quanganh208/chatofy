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

## UI review — the two rules, both now gated

**One accent-filled control per app screen**, and **at most two elevated surfaces**.
`bg-primary` fills at most one control on `/translate`, `/history`,
`/history/[conversationId]`, `/preferences`, `/account`; everything else is ghost,
outline, or a readout. A card is for a thing you act on as a unit — everything else is a
list, a bar, or a region on the page ground.

**Both have a gate.** `apps/web/src/design/accent-budget-app.spec.tsx` counts them per
screen-state, sharing its accent counter with the marketing spec via
`design/accent-count.ts`. `KNOWN_VIOLATIONS` is now **empty**: it shipped holding one row
— `/translate` after a conversation ended drew Start and Generate at once — and the table
is enforced in both directions, so the fix that cleared it was told to delete its own row.

Zero is a normal answer to both. `/history` spends no accent, because the sidebar already
offers the same destination on every screen; `/translate` is the whole screen rather than
a card on one.

Everything else in `docs/design-guidelines.md` is enforced by a spec — the skin guards,
the contrast floors, the token parity, the type scale. These two used to be the exception
on app screens, because "per viewport" is a visual fact. What made them checkable was
narrowing the unit to a screen STATE and counting only controls: a screen is right
before you start and wrong after you stop, and `bg-primary` on a slider range or a
checked switch is a readout, not the action. The marketing page IS covered:
`apps/web/src/components/marketing/accent-budget.spec.tsx` allows at most one per section,
which is where sprawl actually happens.

What neither gate can see is LAYOUT: happy-dom has no box model, so alignment, overflow
and anything measured in pixels stays a review item. A contrast floor has the same blind
spot in one direction — the token specs read tokens, so a composited `opacity` passes them
while breaking the rule they exist for. That cost a stale-rows dim on `/history` that put
the line being read at 4.07:1.

## Tooling

- Use `gh` for GitHub operations when needed.
- Use current docs only when the API/tooling may have changed.
- Use relevant skills by reading their descriptions first, then opening only the needed `SKILL.md`.
- Use `/ak:preview` only when a visual explanation will materially help the user understand the change.
