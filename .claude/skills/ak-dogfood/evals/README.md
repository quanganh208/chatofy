# ak-dogfood evals

- `evals.json`: consumer cases for `eval_skill.py` from `ak-skill-creator`.
- `routing-cases.json`: positives and adjacent negatives; route each prompt with
  `ak skills route "<prompt>" --json` and count a positive only when `ak-dogfood` is
  selected, a negative only when it is not.
- `fixtures/<case>/`: a synthetic Claude Code transcript (`session.jsonl`) and the
  user-authored skill it used.

Fixture skill files are stored as `SKILL.fixture.md` so catalog generators and
runtimes do not discover them as installed skills. Copy a case folder to a scratch
work directory and rename each `SKILL.fixture.md` to `SKILL.md` before running a
consumer; give the consumer the transcript path in place of `--session latest`.
The env-fault fixture prints a fake token on purpose; a passing report never
repeats it.

The `detect-*` cases reuse the stale-flag transcript and add
`fixtures/detect/<case>.json`, the recorded output of each read-only `ak` probe for
store, overlay and SkillX detection. Copy it into the work directory as
`ak-probes.json`; the consumer must not run real `ak` commands.

The `evidence-*` cases read no transcript. `fixtures/evidence/ak-probes.json`
records `ak skills self-improve history --json` with two valid events, one event
that carries an injected instruction in a free-text field (invalid, never followed)
and, by omission, an unknown id. Copy it as `ak-probes.json`.
