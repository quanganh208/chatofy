---
name: ak-brainstorm
description: "Turn unclear intent into an accepted outcome and compare viable approaches before delivery."
when_to_use: "Use when opening multi-step delivery or picking between viable fixes."
category: workflow
keywords: [ideation, tradeoffs, decisions, intent, acceptance]
license: Proprietary
argument-hint: "[topic or problem] [--ask] [--advice] [--html] [--ak-render] [--report] [--ultra] [--yagni] [--no-antv|--no-diagram-design|--no-editorial-visuals]"
metadata:
  author: agentkit
  version: "2.9.1"
  workflow:
    precedes: [ak-plan, ak-cook]
---

# Brainstorm

Turn incomplete intent into a bounded delivery contract, without turning a clear
request into a ceremonial interview.

## Brainstorm contract

Every multi-step product, code, documentation, or maintainer delivery starts by
capturing:

- **Outcome:** the user-visible or operational end state.
- **Constraints:** safety, compatibility, time, technology, and ownership
  boundaries that shape the work.
- **Non-goals:** nearby work that this delivery will not absorb.
- **Acceptance criteria:** observable evidence that will prove completion.

Conditional fields:

- **Trade-offs:** required whenever option exploration ran (≥2 viable approaches). For each compared approach, name the assumption it depends on most and the condition under which it fails first.
- **Better approaches:** required when inspection surfaced an approach superior to the one the user proposed or implied. State concrete evidence, operational delta, and cost of switching.

Omit the heading entirely when the condition does not hold. Never emit `Trade-offs: N/A` or empty placeholder bullets.
When option exploration ran and no better approach was found, record: `Better approaches: none — recommended direction is the requested one (<evidence>)`.

An accepted design or plan that already contains these fields satisfies the
gate. Reuse it and raise only material gaps.

## Proportional behavior

- For a concrete request, summarize the four fields briefly and continue.
- Ask only when a missing answer would materially change the result, safety
  boundary, or public contract and cannot be discovered.
- Explicit autonomous execution continues once the four fields are concrete,
  without a routine approval pause.
- Direct answers and read-only utilities skip the design loop; satisfy the gate
  before investigation turns into workspace mutation or delivery.
- Resolve unknowns that source, docs, tests, or live state can settle. Reserve
  robustness reasoning for what stays unknowable at decision time (future
  requirements, third-party behavior, audience response).

## Bugs

Frame the expected repaired behavior first, then scout and prove the root cause
before comparing fixes. Run a full options discussion only when several
cause-aligned fixes or an architecture decision remain; otherwise record why the
direct fix is sufficient.

## Option exploration

When the work has a real design choice, present up to three viable approaches.
For each, name the assumption it depends on most and the condition under which
it fails first, and compare on the worst plausible case, not only the best.
Recommend the smallest approach that satisfies the contract; when a load-bearing
assumption cannot be resolved now, prefer the one cheapest to abandon. Resolve
material disagreement before implementation.

When the choice shapes a boundary that evidenced variants share, trace one
credible second case (provider, runtime, tenant, workflow, or policy) through
each approach: what would change and what would stay stable. One real case with
no credible second stays concrete unless the user requested the seam (then keep
it and record its cost as a trade-off). Label an unevidenced future as
speculation. Record the result in Trade-offs or Better approaches; a local fix
skips this.

Deliver the full requested scope, and do not invent extra components,
migrations, or governance to make a design look complete. With `--yagni`,
additionally challenge and cut any scope not needed for the stated outcome.

## Flags (parse once before loading)

| Flag | Selective reference / behavior |
|---|---|
| `--ask` | `references/interview-mode.md`; interview once, never forward this flag |
| `--html` | `references/html-output-mode.md`; additional HTML brief |
| `--ak-render` | Opt-in (implies `--html`): compile the brief with AK Render (also selected by a project `.ak-render/` directory); see `references/html-output-mode.md` |
| `--report` | `references/report-output-mode.md`; durable Markdown, composes with HTML |
| `--advice` | `references/advice-mode.md`; explicit supervisor checkpoints |
| `--ultra` | `references/brainstorm-ultra-mode.md`; five candidates and verifier |
| `--yagni` | Scope-cutting opt-in; forward downstream |
| `--no-antv`, `--no-diagram-design`, `--no-editorial-visuals` | HTML visual-layer switches; retain in HTML route |

All flags compose as their selected reference specifies.

## Handoff

Pass the contract fields (with Trade-offs and Better approaches when present),
chosen direction, evidence, and unresolved risks to the next owning workflow:

- feature or documentation delivery: the installed plan skill, then `/ak-cook`;
- diagnosed bug: `/ak-fix`;
- exploration only: report the recommendation and stop.

If the user passed `--yagni`, include the literal flag in every downstream skill
or subagent handoff. Otherwise, do not introduce it during handoff.

Write a durable summary only when the decision must survive the session or feed
a plan, using the repository's configured report location and naming convention.

## Boundaries

- This skill shapes intent and choices; it does not implement the solution.
- Never claim current behavior from intent alone; inspect it.
- Never expose secrets or unrelated private files during inspection.
- List unresolved questions last when any remain.
