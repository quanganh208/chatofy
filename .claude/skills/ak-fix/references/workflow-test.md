# Test Failure Fix Workflow

For failing tests and test-suite regressions.

Fix syntax or compilation errors before running behavior tests. Run the relevant suite
(`npm test`, `bun test`, `pytest`, `go test ./...`), collect every failure and group failures
by module or likely shared cause. Prove each shared cause before modifying code, fix shared
causes first in dependency order, then rerun the narrow failing test and broaden across the
blast radius. If tests still fail, re-diagnose before changing more code.

Change a test only when evidence proves the test is wrong, and check that fixtures and mocks
match the real contracts.
