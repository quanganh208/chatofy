# Apply lanes

Steps for each lane once a proposal is accepted (`--apply`, or the user's yes under
`--ask`). Run a lane's checks before reporting it applied. Commands below name the
current AgentKit surfaces; when a command or flag is missing, check the live
`ak <command> --help` and report the gap instead of guessing.

## Contributor lane (AgentKit kit skill, user can push)

The AgentKit checkout's own `CLAUDE.md` or `AGENTS.md` owns its delivery gates
(preflight, commit policy, PR body, landing) and wins over this list. Read it before
the first commit; this list only adds what is specific to a dogfood change.

1. **Locate the checkout.** Run `python scripts/find_agentkit_repo.py` from this
   skill's directory (use `python3` where `python` is Python 2). It checks
   `$AGENTKIT_REPO`, `$AGENTKIT_KITS_DIR`, the working directory, then scans common
   code folders and, on Windows, each drive. Use `repo.path` when `repo.verified` is
   true. When nothing verifies, ask the user for the path. When the scan found it,
   suggest persisting `AGENTKIT_REPO=<path>` in the user's shell profile so later runs
   skip the scan.
2. **Confirm push access** with `gh api repos/bestagentkits/agentkit --jq
   .permissions.push`. Anything other than `true` moves the proposal to the
   personal-fork lane.
3. **Isolate the change** in a new worktree branched from the canonical remote's
   `dev` (`repo.canonical_remote`), with `ak-worktree` (`create`) when installed,
   else `git -C <repo> worktree add <dir> -b dogfood/<slug> <remote>/dev`. Never edit
   the checkout's current working tree; another session or the user may own it.
   Reuse the current worktree only when this session already runs in one branched
   from `dev` for this work.
4. **Find the source.** The installed `ak-<slug>` comes from
   `kits/<kit>/skills/ak-<slug>/`; shared skills live in `kits/core/`. Check the
   child kit's `kit.yaml` `overrides` before editing, because an override replaces
   the core file in that kit.
5. **Edit, bump and validate.** Bump `metadata.version` (patch for a fix, minor for
   new behavior), then run the kit-skill checks of `ak-skill-creator` (its kit skill
   contract lists them: structure, prompt lint with routing, kit validation, catalog
   regeneration when routing frontmatter changed) and the skill's own script tests
   when scripts changed.
6. **Commit, push and open the PR into `dev`** following the repository instructions,
   with `ak-git` (`cm`, `pr`) when installed. Dogfood additions: search open and closed
   issues first and link matches, and summarize the session evidence in one line,
   described, never quoted. Nothing from the transcript goes into the diff, message
   or PR. Open it ready for review and stop.
7. **Update the installed copy** so the fix helps at once. When the store is
   detected (SKILL.md "Store and SkillX detection"), runtime copies are projections the
   store rewrites: do not patch them. Record the same change as a temporary overlay in
   the personal kit `mine` through the personal-fork lane below, and say in the report
   to remove it with `ak skills evolution rollback <candidateId>` (or
   `ak skills kit rollback mine`) once the PR ships. Otherwise (legacy install) apply the same hunk to each
   runtime copy found in the inventory (for example `~/.claude/skills/ak-<slug>/`,
   `~/.agents/skills/ak-<slug>/` or the project's `.claude/skills/ak-<slug>/`) after
   copying the files it changes to a scratch folder. AgentKit updates treat that copy
   as user-modified and keep it; once the PR ships, reinstall the kit with the force
   option in the current `ak` help to return to the managed copy, and say so in the
   report.

## Personal-fork lane (AgentKit kit skill, any other user)

AgentKit keeps the user's changes in a personal kit overlay under `AGENTKIT_HOME`;
a shared skill becomes a local fork under a non-`ak-` alias. Updates never overwrite
either. The installed `ak-*` files stay untouched.

1. Get the brief: `ak skills improve <skill> --session latest --dry-run --brief --json`
   (add `--project <name>` outside a registered project). Show the redacted evidence
   to the user; never share it on their behalf.
2. Write the draft in a new, empty scratch folder in the overlay layout the brief lists
   (`patches/<path>.diff` as an exact unified diff, or `files/<path>` for whole
   content). Keep it to the accepted proposal. Copy no secret, absolute path, session
   id or excerpt into it.
3. Compile and gate: rerun with `--candidate <draft-dir> --dry-run`, show the diff and
   findings, then rerun without `--dry-run` to record it. The base is the running
   personal kit, else the foundation tree from `--kits-dir` (default
   `$AGENTKIT_KITS_DIR` or `./kits`). Exit 2 means the draft is invalid, 5 the base is
   unresolved (report it and the `--kits-dir` the user should pass; do not guess), 7 a
   secret or path was refused: fix the draft, not the gate.
4. Evaluate first: `ak skills evolution evaluate <candidateId>`. A `regressed` or
   `blocked` verdict stops the lane: report it and apply nothing.
5. Preview the apply: `ak skills evolution apply <candidateId>`. A `regressed` or
   `blocked` verdict is not applied; report it. Otherwise add `--yes`, plus
   `--plan <token>` when the preview asks, after showing `approval.reasons`. A SkillX
   foundation the user does not own refuses with `evolve.apply_refused`; report it as
   proposal only.
6. Project the personal kit with `ak skills kit apply <name>` (default `mine`) so the
   runtime uses the change. Undo with `ak skills evolution rollback <candidateId>`.

A new `@local/<slug>` skill has no foundation: the candidate's base is its own tree in
the personal kit, so the draft edits that tree directly. A missing personal kit
package for the skill is created with `ak skills kit new-skill <kit> <slug>` only when
the user asked for a new skill; that command is new, so check
`ak skills kit --help` first and report the gap when it is absent.

When a command refuses because a lifecycle gate is off, report the step it names. A
store migration such as `ak update --ssot` changes the user's install: run it only
with the user's explicit approval. When `ak` is missing or too old to have
`skills improve`, stop at the proposals and suggest updating AgentKit.

## In-place lane (user or project authored skill)

Copy the files the change touches to a scratch folder, apply the hunk, bump
`metadata.version` when the skill has one, and run `quick_validate.py` and
`lint_cruft.py` from `ak-skill-creator` against the skill directory.

## Proposal-only lane (plugin or third-party skill)

Do not edit the installed files. Give the hunk in the report and, when the user wants
it, offer an upstream issue or a user-owned fork under a different name.

## Optional private publish (SkillX)

Only when SkillX is detected and the user's personal kit changed. Publishing leaves the
machine and is hard to take back, so it is never part of `--apply` or a blanket yes.

1. Suggest, do not run: check `ak skills link status --json`; when not linked, say in
   one line that `ak skills link` connects the account. When linked, show
   `ak skills kit publish <kit> --private`.
2. Run it only when the user says yes to that publish in the same turn.
3. Exit 2 is an invalid kit or `source.unsupported` (SkillX does not accept this kit
   shape yet): report the named code as a normal state, the local change stays
   applied. Exit 10 (`kit.api_disabled`) means personal kits are not enabled for
   the account yet: report it the same way.
