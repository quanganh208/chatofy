# Planning the polish length-guard fix (15/11/2026)

The omission run found that the prod polish does restore a dropped sentence, and that its own length
guard (`2 × draft + 40`) then throws the restore away: the draft is short precisely because a sentence
is missing. This plan decides how to replace that guard without letting runaway answers through.

## What was decided before planning

- The new bound, `2 × max(draft, source) + 40`, applies only to en and vi targets; zh keeps today's rule.
- A regression replay of the 162 judged turns may use at most 170 Command Code calls, at concurrency 1.
- Runaway answers are built synthetically from local data first. No prod logs are read.

## How the plan was chosen

Five plans were written independently from one evidence packet and scored blind out of 100. The
winner scored 85 against 80, 79, 75 and 74. Its edge was executability. Every other plan had at least
one step that fails as written: a relative `cd` into the benchmark folder followed by a repo-relative
`git add`, or a `pnpm --filter` with the wrong package name (the API package is `api`). Nobody broke a
hard constraint: no plan pushes, changes the app before the offline bars pass, goes over 170 calls,
applies the new bound to zh, or commits data.

## What the verifier caught that every plan shared

- **The commentary runaway is decided by construction.** It quotes the whole source, so it is over
  `2 × source + 40` no matter what. Only the context-shaped runaway really tests the new rule.
- **A replayed row's `translation` is no longer the draft.** `armRow` replaces it with the polished
  text, so a regression count that needs the draft must read it from the input file.
- **`| tee` hides exit 3.** That is how the replay reports a stop at the call cap, so a capped run would
  read as finished.
- **One or two newly accepted rows are too few to read as a pass.** Treat n ≤ 2 as inconclusive and
  still judge those rows.

These notes are appended to the plan and get applied during the cook. They are not edits to the
plan's phases.
