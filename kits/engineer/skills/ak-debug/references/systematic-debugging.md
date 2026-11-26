# Systematic Debugging

Four-phase framework that puts root cause investigation before any fix. Complete each phase
before the next; do not propose a fix until Phase 1 is done.

## Phase 1: Root Cause Investigation

1. **Read errors completely**, including warnings and the whole stack trace.
2. **Reproduce consistently.** If it cannot be triggered reliably, gather more data first.
3. **Check recent changes**: git diff, recent commits, new dependencies, config changes.
4. **Gather evidence across component boundaries.** In multi-component systems, log the data
   entering and leaving each component and check environment propagation, run once to see
   where it breaks, then analyze that component.
5. **Trace data flow** back to where the bad value originates (see `root-cause-tracing.md`).

## Phase 2: Pattern Analysis

Find similar working code in the same codebase, read the reference implementation completely,
list every difference however small, and identify the components, settings and environment it
depends on.

## Phase 3: Hypothesis and Testing

Form one specific hypothesis ("X is the cause because Y") and test it with the smallest
change, one variable at a time. If it fails, form a new hypothesis instead of stacking more
fixes. When you do not understand something, say so and ask.

## Phase 4: Implementation

1. **Create a failing test case** that reproduces the bug, automated when possible, before
   fixing.
2. **Implement a single fix** for the identified root cause, with no "while I'm here" changes.
3. **Verify**: the test passes, no other tests broke, the issue is resolved.
4. **If the fix does not work**, count the attempts. Under three, return to Phase 1 with the
   new information. At three or more, stop: each fix revealing new shared state or coupling
   elsewhere means the architecture is in question, so discuss it with the user before more
   fixes.
