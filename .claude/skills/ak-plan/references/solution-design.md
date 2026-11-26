# Solution Design

## Core Principles

- **Full requested scope:** design for everything the user asked for; never trim
  or defer it. Add nothing unrequested.
- **KISS and DRY.**

With `--yagni`, additionally apply **YAGNI** (You Aren't Gonna Need It):
challenge and cut any scope not needed for the stated outcome.

## Trade-offs

Compare approaches on their worst plausible case, not only the expected one, and
weigh short-term against long-term cost.

## Load-Bearing Assumptions

- List the assumptions the design fails without — not every assumption, only the
  ones that carry weight.
- Mark which of those could realistically break within the life of this work;
  resolve the ones a read of source, tests, or live state can settle, and carry
  only the rest forward.
- State the condition under which the chosen design stops meeting its success
  criteria.
- When a load-bearing assumption stays unresolved, prefer the design that is
  cheapest to switch away from; note switching cost and any lock-in the design
  creates.
- For each unresolved assumption, record in the phase's Risk Assessment the
  observable signal that it broke and the pre-decided response — adjust within
  the plan, or stop and replan.
