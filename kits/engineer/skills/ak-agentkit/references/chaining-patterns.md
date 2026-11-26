# Chaining Patterns

How to compose installed skills into a workflow when more than one owner is
needed. Engineer sequences are not re-listed here (see below).

## The Skeleton

Every chain is a subset of:

```
understand → decide → execute → verify → deliver
```

Each link has one owner (helpers feed it, they do not share the pen) and exits
only with a verifiable artifact. Chains of one or two links pass context
in-conversation; longer chains write artifacts to files (`plans/reports/` where
the convention exists) and pass paths, not prose summaries.

## Collapse Rule (keep chains short)

Drop a link that produces no artifact a later link rereads and removes no
verification the risk class demands. A three-link chain that fits the task
beats a five-link chain that fits the diagram. Verification links are exempt
from collapse at elevated and high risk.

## Insertion Rule

Modifiers add links; nothing else does:

- size epic → insert `decide` (planning) if absent, split `execute` by phase.
- risk elevated → insert `verify` if absent.
- risk high → insert `verify` AND an independent review, plus specific authorization before the irreversible step when it is not already established.
- domains 2+ → one execute sub-link per domain, dependency-ordered.

## Engineer Development Sequences

Owned by `../../ak-cook/references/workflow-routing.md` (when installed). Load it when the class is build-feature, fix-defect,
investigate-explain, review-audit, or ship-release on a codebase. If domain
choice is ambiguous first, `../../ak-find-skills/references/domain-routing.md`
resolves it on installs that ship find-skills; otherwise match installed skill
descriptions.

## Marketing Sequences

For marketing installs. Names below are skill names to invoke on installs that
ship them; check each against the live catalog.

**Product discovery** (class discover-validate) — the founder or product-owner
entry point, for a market or idea that has no validated offer yet:

```
ak-play create <name> --template product-discovery   (installs shipping ak-play)
otherwise: ak-marketing-research → ak-competitor → ak-brainstorm (decide)
  → ak-marketing-planning → ak-journal (decision record)
```

When the decision is build, the decision record is the input for ak-brainstorm
→ ak-plan; the discovery chain itself stops at the record.

**Campaign, content and launch** (classes plan-campaign, create-content): use
the ak-play templates `campaign-sprint`, `content-engine`,
`product-hunt-launch` or `saas-launch`. A content-reviewer role gates every
channel before publish (mass-audience send = high risk).

**Funnel diagnosis** (class analyze-performance):

```
ak-analytics → ak-marketing-planning (bottleneck) → ak-form-cro or ak-onboarding-cro (fix)
  → ak-ab-test-setup (prove it)
```
