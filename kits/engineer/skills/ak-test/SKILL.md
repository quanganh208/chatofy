---
name: ak-test
description: "Run unit, integration, e2e and UI tests with coverage analysis, build verification, visual regression and QA reports."
when_to_use: "Invoke for running or designing validation suites."
category: workflow
keywords: [test, unit, integration, e2e, coverage]
argument-hint: "[context] OR run|exec [context] OR ui [url] OR create|update|optimize|audit|review [scope] [--report] [--advice] [--ultra] [--interview]"
metadata:
  author: agentkit
  version: "1.5.0"
  workflow:
    precedes: [ak-git]
---

# Testing & Quality Assurance

Choose useful verification and reuse valid work without increasing release risk.
Measure development time, CI cost, device load and token use before claiming
efficiency gains; a shorter suite or prompt is not itself evidence of better delivery.
Before any report states a measured speedup, regression, latency gate or saving,
run `references/explain-the-number.md` and give its verdict with the named limiter.

## Default (No Arguments)

If invoked with context (test scope), proceed with testing. If invoked WITHOUT arguments, use `ask_user capability` to present available test operations:

| Operation | Description |
|-----------|-------------|
| `(default)`, `run`, `exec` | Run unit/integration/e2e tests |
| `ui` | Run UI tests on a website |
| `create` | Scout the codebase + docs, then create a covering test suite |
| `update` | Reconcile existing tests with an accepted behavior or contract change |
| `optimize` | Inspect affected tests and CI, then reduce measured cost/time safely |
| `audit`, `review` | Inspect the suite + CI and report evidence-backed findings |

Present as options via `ask_user capability` with header "Test Operation", question "What would you like to do?".

## Core Principle

`references/practical-principles-for-setting-up-and-running-tests.md` is the
authority for scope, layer, environment, and execution choices. Every workflow
and operation below assumes it; load it before designing or changing tests.

Before adding tests or launching broad checks, state the contract and its authority,
affected risk, suitable existing check, and missing evidence. A short inline summary
is enough for a small change. A covered refactor may need no new tests.

Investigate every observed failure; never weaken tests, assertions, or policy to obtain
a green result.

## Workflows

### 1. Code Testing (`references/test-execution-workflow.md`)

Execute test suites, analyze results, generate coverage, verify builds. `run` and
`exec` are explicit names for this default operation.

**Load when:** Running unit/integration/e2e tests, checking coverage, validating builds

### 2. UI Testing (`references/ui-testing-workflow.md`)

Browser-based visual testing via `ak-agent-browser`, `ak-chrome-profile`, `ak-web-testing`, or project-native Playwright/Vitest/k6 commands. Covers screenshots, responsive checks, accessibility audits, form automation, and console error collection.

**Load when:** Visual regression testing, UI bugs, responsive layout checks, accessibility audits

### 3. Report Format (`references/report-format.md`)

Compact evidence report template.

**Load when:** Generating test summary reports

### 4. Suite Creation (`references/create-suite-workflow.md`)

`create`: activate `ak-scout` over the codebase and docs, map features and
workflows to a coverage matrix, then design and implement a test suite that
covers them.

**Load when:** `create` argument — bootstrapping or extending a test suite

### 5. Suite Optimization (`references/optimize-suite-workflow.md`)

`optimize`: inspect affected CI/CD workflows, history, code and docs, then reduce
measured work at equal safety using the repository's existing execution policy. For
repository-owned manifests it uses `ak test optimize` for deterministic ranked
selection; explicitly consented semantic modes never remove that baseline.

**Load when:** `optimize` argument — CI too slow/expensive, suite growth pains

### 6. Suite Audit (`references/audit-suite-workflow.md`)

`audit`: inspect the affected suite and CI/CD workflows for deceptive or weak tests,
then report ranked findings and proposed repairs. Audit alone does not authorize edits.

`review` is an alias of `audit`.

**Load when:** `audit` or `review` argument — trust or quality concerns about the suite

### 7. Test Principles (`references/practical-principles-for-setting-up-and-running-tests.md`)

The eleven governing rules for every operation.

**Load when:** choosing test scope, layer, or environment; deciding whether a
slow, flaky, or parallel test earns its place; triaging a failure; or
reconciling tests with changed specifications. Any suite change, optimize or
audit proposal, or QA report must be consistent with these rules.

### 8. Test Lifecycle (`references/test-lifecycle.md`)

**Load when:** adding, retaining, combining, lowering the layer of, or retiring tests;
assessing defect-detection value with bounded mutation and measured cost. This owns
admission/retirement decisions shared by default, create, audit and optimize.

### 9. Explain the Number (`references/explain-the-number.md`)

Seven questions and four verdicts (`faster`, `slower`, `no measurable difference`,
`inconclusive`) for any measured number. `inconclusive` is never a pass.

**Load when:** a report, gate or claim contains a measured timing, throughput,
latency percentile, resource or cost comparison.

### 10. Suite Update (`references/update-suite-workflow.md`)

`update`: map the tests a behavior or contract change affects, classify each
failure, and change an assertion only where the accepted contract changed.

**Load when:** `update` argument — behavior, API, schema or contract changed

### 11. Process and Resource Management (`references/process-and-resource-management.md`)

**Load when:** a run starts servers, watchers, browsers, containers or temporary
roots, or runs beside other sessions or worktrees.

The UI workflow routes to `references/agentic-e2e-workflow.md` only for a project
already using that engine or a user-requested setup. Ordinary runs need neither it
nor a model provider.

## Working Process

1. Resolve repository policy, accepted expectations, changed scope and risk.
2. Select the lowest reliable existing checks; load only the relevant workflow.
3. Reuse results only when their source, inputs, configuration and environment still match.
4. Run missing checks, including mandatory gates; add tests only for an evidenced gap.
5. Investigate failures without changing expectations to fit observed behavior.
6. Check source freshness and report verified scope, gaps, costs and owned-resource cleanup.

## Tools Integration

- **Analysis**: `ak-ai-multimodal` skill for screenshot analysis
- **Debugging**: `ak-debug` skill when tests reveal bugs requiring investigation

## Report Output
Use the repository report location when a durable report is needed; return concise results directly for a small run.

Use naming pattern from `## Naming` section injected by hooks.

## Team Mode

As a teammate, claim the assigned or next unblocked item on the live task and team
surfaces (otherwise read and update the active plan), wait for implementation
prerequisites, edit only the test files assigned to you, and report completion
there. Plan files are the durable source of truth when runtime task tracking is
absent or session-scoped.

## Workflow Position

**Typically follows:** `/ak-cook` (test after implementation), `/ak-fix` (test after bug fix)
**Typically precedes:** `ak-git` (commit once tests pass)

## Flags (create / update / optimize / audit)

`--advice` and `--ultra` are described below.

- `--report` — with `audit`, `review` or `optimize`: read-only. Write the findings
  or the proposed optimization plan as a report and change no test, CI workflow or
  configuration, even when repair would otherwise apply.

- `--interview` — before applying any change, list every proposed change
  (tests added/removed/rewritten, CI workflow edits) with a one-line reason and
  interview the user via `ask_user capability` — one decision per change group;
  apply only the approved changes. Without `--interview`, `create` and `optimize` apply directly and report the full change list; `audit` reports findings unless repair was separately requested.

## Advisory supervision (`--advice`)

When `--advice` is present, run this skill under `kongming` supervision.
`kongming` is an advisory-only supervisor: it returns counsel, never code, and
the main agent stays responsible for every decision, edit, and gate.

Spawn `kongming` at these checkpoints: after the scout/analysis phase (pass the
coverage matrix or findings and ask for a go/no-go plus the top risk); before
applying suite or CI workflow changes (pass the proposed change list); and when
stuck. Invoke with
`delegate_agent capability(subagent_type="kongming", prompt="<task, evidence, approaches tried, the exact question>", description="advice: <checkpoint>")`.
`--advice` never bypasses the failing-test rules or CI safety gates.

## Ultra Verifier Mode (`--ultra`)

When `--ultra` is present with `create`, `optimize`, or `audit`/`review`, run the
analysis/design step as a best-of-5 verifier pass: one immutable evidence
packet (scout reports, CI timings, git history summary), exactly five
independent read-only candidates in one parallel wave, one strongest-model
verifier.

- `create`/`optimize`: the verifier selects the single winning suite design or
  optimization plan unchanged (or rejects all); implementation runs once from
  the winner.
- `audit`: the verifier returns the
  evidence-validated, deduplicated union of audit findings across the five
  candidates — a real deceptive test may be caught by only one candidate;
  repairs run once on the union.

Full mechanics are in `../ak-brainstorm/references/ultra-verifier-mode.md`.
`--ultra` composes with `--advice` and `--interview`.
