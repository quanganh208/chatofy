# Personal Kit and SkillX Lanes (opt-in)

The personal kit, evolution and SkillX lanes are opt-in. They are offered only
when the detect step below finds the matching signal. Without a signal the
skill behaves exactly as the default kit/project/user flow: same targets, same
lanes, no prompt, and no mention of SSOT or SkillX commands unless the user asks
about syncing skills across devices.

Contracts live in the AgentKit repository; link, do not copy:
`docs/specs/personal-kit-contract.md` (manifest, aliases, rollback) and the
`ak-agentkit` skill's ak CLI guide (current flags and exit codes).

## Detect (read-only, once per turn)

Run each command with `--json`, reuse the result for the rest of the turn, and
never read environment variables directly: `ak features list` already merges
environment, preferences, the store mode committed by `ak update --ssot`, and any
rollback hold.

| Signal | Read | Unlocks |
|---|---|---|
| Skill store on | `ak features list --json` → `features[name=skill_store].enabled` (this project); `.scopes.global` when present (global copies) | Runtime skill copies of that scope are projections; edit the source, not the copy |
| Overlays on | same output, `skill_overlays.enabled` | Personal kit lane: `kit new-skill`, overlay, fork |
| SkillX on | same output, `skillx.enabled` | Publish/sync may be suggested |
| SkillX linked | `ak skills link status --json` | Publish proposal can name the direct command; unlinked → one line pointing at `ak skills link` only when the user wants to publish |
| Personal kit exists | `ak skills kit status --json` | Target kit: the kit already overlaying the skill, else `mine` |
| Evolution available | `ak skills improve --help` exits 0 | `improve --session <id\|latest> --candidate` → `evolution evaluate/apply/rollback <candidateId>` |

Treat any of these as "not detected" and continue on the default flow: `ak` is
not on PATH; a command or subcommand is unknown (non-zero exit with "unknown
command"); the JSON does not parse; a command hangs for more than a few
seconds. Record one non-blocking line in the report:
`SSOT/SkillX not detected: <reason>`. Never infer the signal from paths or from
the presence of a personal kit directory. Never run `ak update --ssot`,
`ak skills link` or any enabling command yourself.

## Explicit `--personal` without a signal

Do not prompt. Use the default target (project), and write one line naming the
missing signal and the step that enables it, for example
`--personal ignored: skill_overlays is off; enable with ak update --ssot`.
The user decides.

## Create a new skill in the personal kit

1. Author and validate in a scratch directory:
   `scripts/init_skill.py <slug> --path <scratch> --personal`, then the usual
   capture, authoring, `quick_validate.py` and `lint_cruft.py --routing` steps.
   `--personal` rejects `ak-` slugs (personal aliases never use the AgentKit
   namespace) and writes nothing under `AGENTKIT_HOME`.
2. Confirm the CLI supports the command: `ak skills kit new-skill --help` exits 0.
   If it does not, fall back to the project target and say so in one line.
3. `ak skills kit new-skill <kit> <slug> --from-dir <scratch>/<slug>`
   (`--dry-run` first when the user wants a preview). The skill gets identity
   `@local/<slug>`.
4. `ak skills kit apply <kit>` projects it into the runtime. `ak skills kit status --json`
   confirms the package.

## Update or optimize

- New personal skill (`@local/<slug>`): edit its source in the personal kit, or
  use the evolution path below; the base is the kit's own tree.
- Installed AgentKit skill: never edit the runtime projection while the store is
  on; it is overwritten. Use an overlay, or a fork when the skill is shared
  across kits. Fork aliases never start with `ak-`.
- `optimize --apply` with evolution available:
  `ak skills improve <skill> --session latest --candidate <dir>` (or the
  session ids the user picks) prints a candidate id → `ak skills evolution
  evaluate <candidateId>` → `evolution apply <candidateId>` only when evaluation
  passes → report `ak skills evolution rollback <candidateId>`. Without evolution, keep the default optimize
  flow (proposed diff, apply only with `--apply`).
- SkillX foundation skills do not evolve; report that instead of applying.

## Rollback

`ak skills evolution rollback <candidateId>` reverts an applied evolution;
`ak skills kit rollback <kit>` reverts a kit apply. Name the exact command in the
report after any apply.

## Publish (proposal only)

Publishing is an external, hard-to-reverse action. Only propose
`ak skills kit publish <kit>` when SkillX is on; run it only after the user agrees
separately in that turn. `--apply` never includes publish. If SkillX is not
linked, add one line about `ak skills link`. A local refusal such as
`source.unsupported` (exit 10, for example a new skill whose publish mode SkillX
does not accept yet) is a normal state to report, not a failure to work around.

For public distribution from a repository, see `distribution-guide.md` (SkillX section).
