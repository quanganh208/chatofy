# Intent Detection Logic

Select the mode by the first matching signal, in priority order:

1. Explicit flag: `--interactive`, `--fast`, `--parallel`, `--auto` or `--no-test`.
   `--tdd` composes with any mode and does not change selection.
2. Plan path (`./plans/*`, `plan.md`, `phase-*.md`): `code`.
3. Keywords (case-insensitive): "fast", "quick", "rapidly", "asap" select `fast`;
   "trust me", "auto", "yolo", "just do it" select `auto`; "no test", "skip test",
   "without test" select `no-test`.
4. Three or more distinct independent features ("auth, payments, and notifications";
   "login + signup + password reset"; not "dashboard with charts and tables"), or the
   word "parallel": `parallel`.
5. Default: `auto` (authorized continuation).

## Mode Behaviors

| Mode | Skip Research | Skip Test | Review Gates | Auto-Approve | Parallel Exec |
|------|---------------|-----------|--------------|--------------|---------------|
| interactive | ✗ | ✗ | Explicit checkpoints | ✗ | ✗ |
| auto | ✗ | ✗ | No routine human stops | Within authorized scope | When independent |
| fast | ✓ | ✗ | No routine stops | ✗ | ✗ |
| parallel | Optional | ✗ | No routine stops | ✗ | ✓ |
| no-test | ✗ | ✓ | No routine stops | ✗ | ✗ |
| code | ✓ | ✗ | No routine stops | Per plan | Per plan |

Explicit interactive and advice contracts stay active in every mode.
