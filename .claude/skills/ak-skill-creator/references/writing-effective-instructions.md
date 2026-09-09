# Writing Effective Instructions
<!-- cruft-lint-allow: this file names the patterns the linter reports -->

A skill is a set of practical instructions for a capable model. Write it the
way you would brief a strong colleague: say what you want, why it matters,
and how you will know it worked. Current models take a system prompt
literally and follow it closely, so calm, specific, reasoned text outperforms
emphasis.

## Writing style

Write in imperative form, verb first, in complete sentences.

- Good: "To validate the export, run `scripts/validate.py --input {file}`."
- Bad: "You should probably validate the data before proceeding."

Describe the audience, the product, the environment, and the quality bar.
That context is the part of a skill only the author knows; the model can
supply the rest.

## Writing for current models

These ten rules replace the older "critical headers, repetition, and
terseness" advice. `scripts/lint_cruft.py` flags most violations; see
`references/prompt-cruft-patterns.md` for the signals and the keep list.

1. **Say what you want at normal volume.** "Use this tool when…" instead of
   "CRITICAL: You MUST…". Attach a reason to every real constraint. Use
   emphasis at most once or twice per skill, and only for an instruction you
   have measured being ignored.
2. **Describe the goal, not the method.** For work that needs judgment, state
   the outcome, the constraints, and how to verify. Number steps only when
   order is a safety condition (destructive commands, auth flows, compliance);
   there, give the exact command and say "do not modify this command".
3. **Delegation is context, not a threat.** Say when to delegate and why
   (a fresh context catches what the implementing context has already
   rationalised). Do not write "INCOMPLETE" or "DO NOT do X yourself", and do
   not forbid parallel delegation; current models handle it well.
4. **Prohibitions need provenance.** Keep a "never" only when it encodes a
   business or safety rule with a stated reason. Rewrite style prohibitions
   written for older models as one sentence describing the desired result.
5. **Say it once, in the right place.** No repeated key points; one closing
   recap is enough. Do not paste agent boilerplate such as "ensure token
   efficiency": token use and effort are model configuration, not prose.
6. **Reports lead with the outcome, in complete sentences.** Keep them short
   by choosing what to include, not by compressing into fragments,
   abbreviations, or arrow chains.
7. **No numeric caps on prose.** Replace "3-4 sentences max" with a
   description of the reader and the purpose. Keep real format requirements
   (a table, a named section) as format instructions.
8. **Examples: few, varied, labelled illustrative.** A single gold output
   freezes an older model's habits into the new one. Keep examples only where
   the output shape is format-sensitive.
9. **No volatile facts.** Model names, context sizes, version pins, and hard
   paths drift. Link the machine-readable owner (for example
   `docs/conformance/runtime-support-matrix.yaml` or `skill.yaml`) or omit.
10. **Do not write in diff style.** "X now works differently" and "no longer"
    describe a prompt version the model never saw. Write as if the current
    rule is the only rule.

Cruft is not length. Never delete a line because of a character count; delete
it because it has no purpose for the current model.

## Recommended SKILL.md shape

```markdown
---
name: your-skill  # or namespace:your-skill
description: [What it does] + [when to use it] + [what it does not cover]
---
# Skill Name
Purpose in two or three sentences, including the audience and quality bar.
## When to use
Trigger situations, and the neighbouring skills that own adjacent work.
## How to work
Outcome, constraints, and verification. Exact commands for fragile steps.
## Resources
One line per bundled script, reference, and asset, with when to open each.
```

Add `## Examples` only when the output shape is format-sensitive, and label
each example illustrative. Add `## Troubleshooting` when a failure recurs and
has a known fix.

## Be specific about fragile steps

Good:

```markdown
Run `python3 scripts/validate.py --input {filename}` to check the format.
If validation fails, the usual causes are missing required fields or dates
that are not in YYYY-MM-DD form.
```

Bad:

```markdown
Validate the data before proceeding.
```

For a check that must be deterministic, bundle a script and call it, rather
than describing the check in prose.

## Reference bundled resources clearly

```markdown
Before writing queries, read `references/api-patterns.md` for rate limits,
pagination, and error codes.
```

Keep SKILL.md under 300 lines and move detailed API documentation, schemas,
extended examples, domain rules, and troubleshooting into `references/`.

## What not to include

- General knowledge the model already has.
- Tool documentation. Teach the workflow, not what the tool is.
- Text that duplicates a reference. Information lives in one place.
- Boilerplate copied from another skill or agent without a reason that
  applies here.
