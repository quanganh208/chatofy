## Advisory supervision (`--advice`)

When `--advice` is present, run this skill under `kongming` supervision.
Load `advisory-supervision.md` for supervisor identity, host detection, model
routing, and the PR gate.

Spawn `kongming` at these checkpoints:

- **After each decision round completes:** pass the goal, what was concluded,
  and the evidence; ask for a go/no-go and the next risk to watch.
- **When stuck:** repeated failures, a blocked step, or contradictory evidence;
  pass everything already tried and the exact obstacle.
- **Before a high-stakes decision:** a design fork, a public-contract or
  security-sensitive change, or an irreversible action.

Pass `--advice` to the downstream plan, cook, or fix skill so supervision
persists across the handoff; the PR review gate runs there.
