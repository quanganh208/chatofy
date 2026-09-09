# Skill Creation Workflow

The `create` subcommand follows this sequence. Steps 0, 4, and 6 are
ordered because a later step consumes the earlier one's output; the rest can
overlap. Skip a step only when you can say what already covers it.

## Step 0: Choose the target

Decide where the skill lives before writing anything, because the target
sets the namespace, the frontmatter fields, and the validation path. Use
the table in `references/agentkit-kit-skill-contract.md` ("Choosing a
target"). Default to the current project scope; use a kit target only inside
the AgentKit repository, and user scope only when the user asks for it.

## Step 1: Capture intent

Ask through the `ask_user capability` until the scope is clear:

- What tasks should the skill handle, and what should it refuse or hand off?
- Which phrases would a user actually say that should trigger it?
- What does a good output look like, and who reads it?
- Which neighbouring skills already cover adjacent work?

Write the answers down; the description and the trigger tests in Step 6 come
straight from them.

## Step 2: Research

Activate `/ak:docs-seeker` for current documentation and investigate
practices, existing CLI tools worth reusing, and known pitfalls. Run
independent lookups in parallel through the `web_search capability` and
scouting delegates, and keep a short note of findings for Step 3.

## Step 3: Plan reusable contents

For each example from Step 1, ask how you would do it from scratch and what
would let the skill do it again without re-deriving it:

- Repeated code → `scripts/`, with tests under `scripts/tests/`.
- Repeated discovery (schemas, APIs, domain rules) → `references/`.
- Repeated boilerplate (templates, images) → `assets/`.

Prefer an existing CLI invoked through a pinned ephemeral runner
(`npx -y pkg@x.y.z`, `pipx run pkg==x.y.z`, `uvx --from 'pkg==x.y.z' cmd`)
over custom code; the dependency then lives in a central cache rather than
inside the skill. Scripts declare their dependencies at the invocation site
and respect the `.env` hierarchy. Decision tree:
`references/script-dependency-strategy.md`.

Check the installed skill catalog for overlap; consolidate into an existing
skill when the topics are the same domain.

## Step 4: Initialize

From the skill-creator directory:

```bash
python3 scripts/init_skill.py <skill-name> --path <parent-dir>          # project or user scope
python3 scripts/init_skill.py <slug> --path kits/<kit>/skills --kit <kit> # kit scope: ak:<slug>, ak-<slug>/
```

The script writes a short SKILL.md skeleton with the frontmatter the target
needs and no example files. Skip this step when the skill already exists.

With `--long-horizon`, continue from the initialized directory using
`references/long-horizon-repository-architecture.md` for the surfaces, the
harness file, and the scaffold manifest, and
`references/long-horizon-scaffold-templates.md` for the generated files. Steps 5
through 8 then follow `references/long-horizon-building-loop.md`.

## Step 5: Write the skill

Implement the resources planned in Step 3 first, then write SKILL.md
following `references/writing-effective-instructions.md`: purpose with
audience and quality bar, when to use and what to hand off, how to work
(outcome, constraints, verification), and one line per bundled resource.
Keep it under 300 lines.

Write the `description` last, from the Step 1 phrases: what it does, when to
use it, what it does not cover. Routing text may be pushy; the body stays
at normal volume. Examples and limits:
`references/metadata-quality-criteria.md`.

Include a three-line scope and security note ("handles X, does not handle
Y; refuses Z") when the skill touches credentials, external services, or
user data. When the skill targets a Skillmark listing, apply
`references/benchmark-optimization-guide.md` as well.

## Step 6: Validate and test

Run the validators from the skill-creator directory and fix every High
finding before continuing:

```bash
python3 scripts/quick_validate.py <skill-dir>
python3 scripts/lint_cruft.py <skill-dir>
```

Then test triggering and behavior by hand, following
`references/testing-and-iteration.md`:

1. List 10–20 prompts, half that should trigger the skill and half that
   should not, and run them in a fresh session. Ask "When would you use the
   <skill> skill?" to see the description quoted back.
2. Run one representative task with and without the skill and compare the
   transcripts: tool calls, corrections needed, output quality.
3. Record both results in `plans/reports/` so the next iteration has a
   baseline.

For a kit skill, also run the kit validation and contract tests listed in
`references/agentkit-kit-skill-contract.md`.

## Step 7: Package or register

- Project or user skill: nothing further; the runtime discovers it in place.
- Marketplace or package: `python3 scripts/package_skill.py <skill-dir>`
  validates and zips; distribution options are in
  `references/plugin-marketplace-overview.md` and
  `references/cross-marketplace-distribution.md`.
- Kit skill: register it in `kit.yaml` and bump `metadata.version`.

## Step 8: Iterate

Use the skill on real tasks and note where it under-triggers, over-triggers,
or needs correction (`references/testing-and-iteration.md`, "Iteration
signals"). Generalize from the pattern rather than patching the one example.
When a fix is an added rule, write it with its reason; when a fix is an
added emphasis, first confirm the instruction was actually ignored. Re-run
Step 6 after each change.
