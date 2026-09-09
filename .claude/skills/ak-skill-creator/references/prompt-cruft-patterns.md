# Prompt Cruft Patterns
<!-- cruft-lint-allow: this file names the patterns the linter reports -->

Prompt cruft is instruction text written for an older model that now works
against the current one. It hides well: it reads like ordinary emphasis, it
was often added to fix a real bug at the time, and copying it between skills
feels like consistency. This reference gives the `audit` and `optimize`
subcommands a shared vocabulary: what to look for, why it is obsolete, what
to write instead, and what to leave alone.

`scripts/lint_cruft.py` implements the signals below. It reports and never
edits. Rule ids in the table match the script's `--json` output.

## Classify by function before you judge

The same words mean different things in different places.

- **Routing text** (`description`, `when_to_use`, trigger blocks, keyword
  lists) is allowed calibrated urgency: it competes with other skills for
  activation. Leave "use this skill whenever…" alone.
- **Behavioral text** (the SKILL.md body, references, agent bodies, output
  styles, hook text injected into context) must explain, not shout. Every
  rule below applies here.
- **Fragile scripts** (destructive commands, auth flows, compliance steps)
  keep their exact wording. Mark the block with `<!-- fragile -->` so the
  linter skips it.

## Pattern table

| Rule id | Level | Signal | Why it is obsolete | Replacement |
|---|---|---|---|---|
| `pressure-density` | High at 8+ per file or 3 in any 10 lines; Medium at 4+ | MUST, NEVER, ALWAYS, CRITICAL, IMPORTANT, MANDATORY in body text | Current models follow the system prompt closely; stacked emphasis over-triggers and makes behavior rigid in grey areas | State the rule once at normal volume with its reason |
| `emphasis-no-reason` | Medium | A pressure word with no "because", "so that", or "otherwise" within two lines | Emphasis without a reason cannot be applied with judgment | Add the reason or drop the emphasis |
| `threat-language` | High | "INCOMPLETE", "DO NOT … yourself", "never skip", "MANDATORY —" | Threats produce compliance theatre (spawning agents for a typo fix) rather than judgment | Say when the step matters and why a fresh context helps |
| `report-compression` | High | "sacrifice grammar" | Current models already write densely; fragments and arrow chains are the documented readability failure | "Lead with the outcome; keep it short by being selective, in complete sentences" |
| `token-booster` | High | "ensure token efficiency", "be extremely concise" | Effort and token use are model configuration, and the phrase trims exactly the reasoning you want | Delete |
| `delegation-suppressor` | High | "avoid spawning", "do not delegate", "only delegate when", "can cause performance issues" | Written for models that mishandled parallel sub-agents; current models delegate asynchronously and keep working | Describe the delegation contract (scoped prompt, files it may touch) instead |
| `numeric-cap` | Medium | "at most N words/sentences/bullets", "N sentences max", "under N words", "every N tool calls" | Caps replace judgment about the reader with a number | Describe the reader and the purpose; keep true format requirements |
| `duplicate-line` | Medium | The same prose instruction appears twice in one file | The model reconciles two wordings and pays for it every turn | Keep one instance; one closing recap is enough |
| `step-choreography` | Low | Four or more "Step N" headers with no statement that order matters | Prescriptive sequencing lowers output quality on work that needs judgment | Outcome, constraints, verification; number only safety-ordered steps |
| `prohibition-run` | Medium | Three or more consecutive lines starting with "Do not", "Never", "Avoid" | Lists of style prohibitions were fixes for older models' habits | One sentence describing the desired result, with a reason for any rule kept |
| `thinking-scaffold` | High | "think step by step", `<scratchpad>`, `<thinking>`, "take a deep breath" | Adaptive thinking replaces manual scaffolds and the scaffold competes with it | Delete; configure thinking on the request |
| `anti-formatting` | Medium | "never use bullets/headers/bold", "plain text only" | Written against older models' over-formatting; current models format by audience | Delete, or state the actual audience |
| `narration-suppressor` | High | "hold findings", "don't narrate", "no interim" | Suppresses the progress updates that keep long autonomous turns legible | Delete; ask for grounded progress claims instead |
| `volatile-fact` | Medium | Context sizes, model names, version pins, hard paths in behavioral text | Drifts silently on every model or release change | Link the machine-readable owner or omit |
| `migration-phrasing` | Low | "no longer", "now works", "previously", "used to" attached to a behavior rule | Describes a diff against a prompt the model never saw | Write the current rule as the only rule |
| `identity-stub` | Low | "You are a helpful/expert/elite …" with no audience or product context nearby | An identity line without context adds nothing the model lacks | Replace with audience, product, environment, quality bar |
| `budget-countdown` | High | "% used", "tokens left/remaining", "context nearly full" rendered into the prompt | Causes premature wrap-up and rushed final work | Keep it in the status line; never in the prompt |

Repeated code, paths, and parameter rows are not duplication, and neither is
the same instruction appearing in many files: each skill, agent, and output
style is loaded into its own context, so shared text is per-file instruction.
`--cross-file-duplicates` reports it anyway, at Low, when you are looking for
boilerplate worth centralising or auditing files that do share one context.

## Opt-out markers

Three markers tell the linter to stand down, and each one wants a reason
written next to it so the next reader knows the finding was judged, not
missed.

| Marker | Scope | Use it for |
|---|---|---|
| `<!-- cruft-lint-allow: reason -->` on a line of its own | the whole file | A reference whose subject matter is prompting itself, where the pattern vocabulary is the content |
| `cruft-lint-allow` trailing a content line | that line | A single keep-list line, such as a word cap on rendered UI copy or a severity scale that happens to read as emphasis |
| `<!-- fragile -->` … `<!-- /fragile -->` | the block | Exact scripts for destructive, auth, or compliance steps, where rewording changes behavior |

The file-level marker only counts on a line of its own. That is deliberate:
the same marker trailing a content line stays a line-level opt-out, so a
keep-list note cannot silently switch off the rest of the file.

Structural checks (`quick_validate.py`) sit beside these: description at
most 1024 characters including block scalars, SKILL.md and references under
300 lines, broken `references/` and `scripts/` links, and literal native tool
names that the kit capability lint rejects.

## Keep list

`optimize` must not remove these, whatever the linter says:

- Context only the author knows: audience, product, environment, quality
  bar, the reason behind a rule.
- Exact scripts for fragile operations, with their "do not modify" note.
- Tool and parameter contracts. These usually need more text, not less.
- Prohibitions whose failure still reproduces on the current model.
- Calibrated urgency inside routing text.
- Examples that pin a format-sensitive output shape, labelled illustrative.
- One closing recap.
- Redundancy that is working and not contradictory.

Cruft is not length. A finding must name the purpose the text no longer
serves; a character count is never a reason.

## Audit procedure

1. **Inventory the surface.** SKILL.md, references, agents, output styles,
   and any hook text that is injected into context (hooks render prompt
   text too, and re-inject it on a timer).
2. **Establish provenance.** For each emphasized or prohibiting line, ask
   which failure it blocked, on which model, and whether the failure still
   reproduces. `git log -S"<phrase>"` and `git blame` usually answer the first
   two; a short probe on the current model answers the third.
3. **Run the linter.** `python3 scripts/lint_cruft.py <path> --json` gives
   rule ids, levels, and `file:line` anchors.
4. **Classify each finding** against the pattern table and the keep list.
   Assign confidence: High when the text is a known pattern and no keep-list
   reason applies; Medium when it needs a rewrite rather than a deletion; Low
   when it is a flag for the author.
5. **Write the report** to `plans/reports/skill-audit-{YYMMDD-HHmm}-{slug}.md`:
   stated assumptions (scope, target model), inventory, findings with
   `file:line`, pattern, reason, and confidence, then a proposed diff with one
   hunk per High or Medium finding. Audit never edits skill files.

## Optimize procedure

1. Take the High and Medium findings from an audit report, or run the audit
   inline on the given skill.
2. Rewrite rather than delete when the instruction still has a purpose:
   attach the reason, lower the volume, move it to the one place it belongs.
3. Merge or split references so each fact lives in exactly one file. Leave
   `description` and `when_to_use` alone unless the audit named them.
4. Verify: linter clean at High, `quick_validate.py` clean, kit validation and
   contract tests green for kit skills.
5. **Probe the behavior.** Run one representative task with the skill before
   and after on a scratch copy and compare the transcripts. Asking the model
   whether a line is needed is not a probe; the model has no evidence either.
6. Emit a diff by default, or apply it with `--apply`, and record the probe
   result in `plans/reports/`.
