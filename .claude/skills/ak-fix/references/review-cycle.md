# Review Cycle

Mode-aware handling of code-review findings. Critical findings always block: security
vulnerabilities, data loss risks, breaking changes without migration, architectural violations,
and avoidable performance regressions.

## Autonomous (`--auto`)

Fix critical findings, rerun the tests and review again, up to 3 cycles (1 cycle in quick
mode). Non-critical warnings are logged, not blocking. If critical findings remain after the
last cycle, escalate with the `ask_user` capability, show the findings and offer "Fix manually",
"Approve anyway" or "Abort".

## Human-in-the-loop (`--review`)

After every review, show critical findings, warnings and suggestions, then ask with the
`ask_user` capability. With critical findings offer "Fix critical issues", "Fix all issues",
"Approve anyway" or "Abort"; otherwise "Approve", "Fix warnings/suggestions" or "Abort". A fix
choice means implement, retest and review again, up to 3 cycles.
