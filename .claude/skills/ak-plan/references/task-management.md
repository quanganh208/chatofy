# Task Management Integration

Plan files are the durable source of truth. A runtime task view is an optional,
session-scoped projection for visibility and coordination, never a dependency.

## When to Hydrate

Hydrate by default after writing a plan with at least three meaningful phases.
Skip when `--no-tasks` is requested or when the plan is too small to benefit.

For an HTML-authoritative plan, hydrate only from a companion Markdown index
that contains actionable checkboxes. Otherwise, leave runtime tracking empty and
state that `plan.html` is the authoritative artifact.

## Hydration

1. Read `plan.md` and every `phase-XX-*.md` file; checked items are complete,
   unchecked items are remaining work.
2. Discover the live task-management surface at runtime. Never infer support
   from a client name, environment, or cached tool list.
3. If available, mirror remaining work, preserving phase dependencies, ownership,
   and enough context to map each runtime item back to its phase file and
   checklist item. If not, keep status current in the plan files.

## Cook Handoff

In the same session, Cook may reuse the live view after confirming it matches
the plan. In a new session, or when the view is absent or stale, Cook rebuilds
it from unchecked plan items. The plan always wins when states disagree.

## Sync-Back

Before claiming completion, sweep every phase file (not only the active one),
reconcile completed runtime work with source checklist items, backfill stale
checkboxes in earlier phases, and derive plan status and progress from actual
checkbox state. Report any item that cannot be mapped. Runtime counts are
advisory; plan checkbox state determines durable progress.
