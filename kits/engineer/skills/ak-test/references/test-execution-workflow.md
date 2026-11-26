# Test Execution Workflow

## Scope

Determine what to test based on recent changes:
- New feature → affected behavior and new acceptance cases; broaden for shared contracts
- Bug fix → regression tests + targeted fix validation
- Refactor → existing test suite (no new tests unless gaps found)
- Coverage check → full suite with coverage flags

The risk-scope and lowest-reliable-layer rules in
`practical-principles-for-setting-up-and-running-tests.md` govern this list.
Resolve the accepted contract and its authority before choosing checks. Use native
deterministic mappings and preserve mandatory groups/full-suite fallback. AI advice
cannot suppress checks. Read `test-lifecycle.md` only if adding/changing tests or
assessing whether an existing test should remain.

## Execution and freshness

Start with the smallest check that can establish the affected contract. Use the
repository-authoritative commands; do not download packages or replace configured
runners. Reuse passing evidence only when revision, configuration and environment
assumptions remain unchanged.

Record changed/dirty/untracked inputs and a source fingerprint before and after
execution. A commit SHA alone does not identify a modified worktree. If freshness
cannot be established, report the tested state and gap; do not certify the final
source from stale output.

Reuse an owned running service when compatible. Bound execution, retries and
workers; track started process IDs, ports, containers and temporary roots. Store
each attempt's output separately and clean up only resources this run owns.

## Coverage

Use repository-defined line/branch thresholds when present. If no threshold exists,
report actual coverage and missing critical behaviors; do not invent a percentage gate.

## Completion

Use `report-format.md` to report achieved scope and outstanding evidence. A skipped
mandatory check is not a pass. Preserve raw failure/exit codes and distinguish
product, expectation, fixture, provider and tooling failures. Retries do not erase
the first failure. Verify owned-resource cleanup on success, failure or timeout;
report interrupted/unverified cleanup without killing another session's processes.
