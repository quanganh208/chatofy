# Subagent Timing

What a delegation must carry, what may run in parallel, and how dispatch
differs per runtime. Resolve roles against the live installed agent catalog;
agent names here are examples, not a roster.

## When to delegate

A subagent buys a fresh context window, an enforced tool boundary, parallel
wall-clock, or a specialist prompt. Delegate large, separable work that needs
one of those: parallel read-only exploration of independent areas, phase
implementers with disjoint files on epic work, an independent reviewer before
ship, publish or a high-risk change, a debugger handed all evidence after the
same failure twice. On a model below `fable`, an installed strategist
(`kongming`) gives one-reply counsel when stuck or at a high-stakes fork.
Otherwise work inline: small edits, work that needs the conversation history,
and questions the user is answering live.

Select delegation only when allowed by the active runtime and user
instructions. Direct verification satisfies routine work; explicit
advice/ultra modes retain their own contracts.

## Delegation Contract

A subagent cannot see the conversation, so every spawn carries:

1. **Task**: one verifiable outcome.
2. **Files to read**: exact paths, unless scouting is the task.
3. **Files it may modify**: explicit ownership; empty for read-only roles.
4. **Acceptance criteria**.
5. **Constraints**: patterns to follow, things not to touch, no commit or push
   unless the controller assigns git operations.
6. **Report path**: `plans/reports/` when the project keeps reports;
   otherwise return in the result.
7. **Status line**: `Status: DONE | DONE_WITH_CONCERNS | BLOCKED |
   NEEDS_CONTEXT` plus a one-line summary.

Handle `BLOCKED` / `NEEDS_CONTEXT` by changing context, scope or approach
before re-delegating; never resend a failing prompt unchanged. Relay
`DONE_WITH_CONCERNS` items verbatim.

## Parallel Safety

- Run agents in parallel only when each can finish on its own, with disjoint
  file ownership decided before spawning. Read-only explorers parallelize
  freely.
- Never parallel-edit the same file, generated artifact, migration sequence,
  or shared config.
- Merge decisions, conflict resolution and user approvals stay in the
  controller session.
- Keep concurrent spawns to a handful (3-4): more burns quota and returns
  reports faster than they can be verified.

## Runtime dispatch

Resolve agent capabilities through the runtime's current tool catalog. Use native delegation when exposed; use a registered AgentKit agent runtime only when actually available. Do not assume subprocess latency, model availability or tool names from another host, and do not install/register or restart a runtime merely to delegate routine work. If no suitable capability is present, execute directly and identify a material review gap when one remains.
