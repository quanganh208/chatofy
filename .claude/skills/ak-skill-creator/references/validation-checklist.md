# Skill Validation Checklist
<!-- cruft-lint-allow: this file names the patterns the linter reports -->

Run the scripts first, then walk the checklist. All three scripts are
standard-library Python and run from the skill-creator directory:

```bash
python3 scripts/quick_validate.py <skill-dir>          # structure, frontmatter, limits, links
python3 scripts/lint_cruft.py <skill-dir-or-kits-dir>  # dated prompt patterns
python3 scripts/package_skill.py <skill-dir>           # zip for distribution
```

For a kit skill, also run `cd apps/cli && go run . kit validate ../../kits/`
(see `references/agentkit-kit-skill-contract.md`).

## Must pass

### Metadata
- [ ] `name` is `skill-name` or `namespace:skill-name`, kebab-case, at most 64 characters per segment
- [ ] `description` is at most 1024 characters (150–400 is the useful range), names concrete triggers and what the skill does not cover
- [ ] `when_to_use` present for kit skills (one sentence, third person)

### Size and structure
- [ ] SKILL.md under 300 lines; each reference under 300 lines
- [ ] Every `references/` and `scripts/` link in SKILL.md resolves
- [ ] No information duplicated between SKILL.md and references
- [ ] File names are kebab-case and self-describing; no leftover template files

### Prompt quality (`lint_cruft.py` reports no High findings)
- [ ] No pressure walls (clusters of MUST, NEVER, CRITICAL); each real constraint carries a reason
- [ ] No "sacrifice grammar", "ensure token efficiency", or other copied boilerplate
- [ ] Delegation guidance says when and why, not "INCOMPLETE" or "do not do X yourself"
- [ ] No numeric caps on prose, no thinking scaffolds, no anti-formatting rules
- [ ] No volatile facts (model names, context sizes, version pins) without a link to their owner

## Scripts, if any
- [ ] Tests exist under `scripts/tests/` and pass
- [ ] Cross-platform (Python or Node.js); UTF-8 console configured on Windows
- [ ] Dependencies declared at the invocation site (pinned runner or inline metadata), see `references/script-dependency-strategy.md`
- [ ] `.env.example` shipped, never `.env`; env hierarchy respected (`process.env` > skill `.env` > shared `.env` > global `.env`)

## Quality
- [ ] Imperative form; third-person `description` and `when_to_use`
- [ ] Teaches how to do the task, with the audience and quality bar stated
- [ ] Concrete trigger phrases listed for testing (`references/testing-and-iteration.md`)
- [ ] Delegation, when present, names the agent and the reason a fresh context is needed

## Integration
- [ ] No overlap with an existing skill; adjacent skills named in `description` as not-for
- [ ] Related topics consolidated rather than split into near-duplicate skills
- [ ] For kit skills: `metadata.workflow` refs resolve in every consuming kit; contract tests still pass
