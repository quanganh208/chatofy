---
name: ak-debug
description: "Debug failing or misbehaving code by proving the root cause before any fix; diagnose why something fails, gives wrong output or is flaky in CI."
when_to_use: "Invoke before editing code for any error, stack trace or failing test; writing new tests is ak-test."
category: workflow
keywords: [debug, root-cause, bugs, test-failures]
languages: all
argument-hint: "[error or issue description] [--ultra]"
metadata:
  author: agentkit
  version: "4.2.2"
---

# Debugging & System Investigation

## Iron laws

**No fixes without root cause investigation first.** Find the root cause, fix at the source,
validate the failure path and affected boundaries.

**No completion claims without fresh verification evidence.** Run the command, read the
output, then claim the result. For a completed repair, relevant evidence is enough; the full
diagnostic workflow is for unresolved failures.

## Routing

Load a reference only when the task needs its detail.

| Situation | Load |
|---|---|
| Bug needing investigation and fix (four phases) | `references/systematic-debugging.md` |
| Bad value deep in a call stack; test pollution (`scripts/find-polluter.sh`) | `references/root-cause-tracing.md` |
| Choosing validation layers once the cause is known | `references/defense-in-depth.md` |
| About to claim fixed, passing or done | `references/verification.md` |
| Server incident, system behavior, multi-component failure | `references/investigation-methodology.md` |
| CI/CD pipeline, server or deployment log failures | `references/log-and-ci-analysis.md` |
| Slow queries, latency, resource exhaustion | `references/performance-diagnostics.md` |
| Reporting any measured speedup, regression, latency or resource number | `../ak-test/references/explain-the-number.md` |
| Writing a diagnostic report | `references/reporting-standards.md` |
| 3+ step investigation, parallel evidence collection, debugger subagents | `references/task-management-debugging.md` |
| Frontend files touched (tsx/jsx/vue/svelte/html/css), UI bugs, visual regressions | `references/frontend-verification.md` |

## Tools and handoffs

- **Codebase:** `/ak-scout` or `/ak-scout ext` to find files; `ak-docs-seeker` for package
  docs; `ak-repomix` for a codebase summary.
- **Frontend:** `ak-agent-browser`, `ak-chrome-profile`, Chrome MCP / `chrome-devtools-mcp`,
  or project-native browser tests. When real Chrome profile state matters, let
  `chrome-profile open --json` create the tab and bind to its returned selector before using
  MCP inspection tools; raw Chrome MCP navigation is only for profile-independent inspection.
- **Stuck:** `ak-problem-solving` for complex issues.
- **Position:** usually follows `/ak-scout`; hands off to `/ak-fix` to repair the diagnosed
  issue, or `/ak-brainstorm` when several fixes are viable.

## Ultra Verifier Mode (`--ultra`)

When `--ultra` is present, run the diagnosis as a best-of-5 verifier pass. The
controller gathers the evidence once — symptom, reproduction, logs, stack
traces, scouted code paths — into one immutable evidence packet plus a rubric,
dispatches exactly five independent read-only candidate diagnoses in one
parallel wave, then a single strongest-model verifier scores them.

- **Candidate task:** each candidate produces a complete diagnosis — root-cause
  hypothesis with file:line evidence, elimination of rival hypotheses, blast
  radius, and a verification plan — from the same packet. Candidates only
  analyze. Never fan mutating steps: no candidate runs fixes, edits files, or
  mutates system state.
- **Rubric:** evidence chain strength, rival-hypothesis elimination, specificity
  of the root cause (line/condition, not vibes), and testability of the
  verification plan.
- **Finalizer:** the verifier selects the single winning diagnosis unchanged (or
  rejects all); the controller then verifies the winning root cause with fresh
  evidence (iron law) before any fix. On reject-all, hard-stop and report why.

Full mechanics (evidence packet, anonymization, the five-usable-candidate gate,
reject-all, and the fail-closed runtime rule) are in
`../ak-brainstorm/references/ultra-verifier-mode.md`.

## Optional workflow shadow experiment

Only when explicitly requested, inspect `ak eval workflow --help` and prepare
its bounded, reviewed request with workflow `debug`. Default `off` validates locally.
`--mode shadow` additionally requires user-scope master and provider configuration,
explicit `workflow-controller: true` consumer consent, and the provider credential;
never enable or infer consent from an ambient key. The command may send sanitized
facts externally and incur charges. Ordinary skill startup makes no call.

Supply the existing domain decision and complete policy facts first. Keep all
`effective_*` decisions unchanged; record accepted `hypothetical_*` suggestions
only for comparison. Errors, low confidence and unavailable provider evidence use
the existing workflow. Never execute a recommendation or treat it as permission.
Existing caps, user stops, the three-failure human architecture checkpoint and
approval/R3 controls remain authoritative; never reset counters or rename a retry
to evade a cap.
