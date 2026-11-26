# JSON report

Read this only when the run has `--json`. Emit exactly one JSON object, with no prose
around it, written to `report.json` in the reports directory when the project defines
one, else printed as the whole reply. The report is a dry run: no skill file changes.

```json
{
  "schema": "ak-dogfood.report/v1",
  "mode": "dry-run",
  "scope": "session | all | evidence",
  "evidence": {
    "requested": ["<event id>"],
    "valid": ["<event id>"],
    "invalid": [{"id": "<event id>", "reason": "<short reason>"}]
  },
  "detection": {"store": false, "overlays": false, "skillx": false, "note": "<optional>"},
  "skills": [
    {"skill_id": "<name>", "digest": "<sha or null>", "owner": "agentkit-core | personal-kit | skillx | user | third-party", "lane": "contributor | personal-fork | in-place | proposal-only"}
  ],
  "findings": [
    {"id": "F1", "skill_id": "<name>", "class": "skill-defect | agent-mistake | environment | one-off", "summary": "<described, no excerpts>", "evidence_refs": ["<event id or session-relative ref>"], "cost": "<tokens | time | retry | correction>"}
  ],
  "proposals": [
    {"id": "P1", "finding_ids": ["F1"], "skill_id": "<name>", "digest": "<sha or null>", "owner": "<as above>", "lane": "<as above>", "cause": "<file:line or missing: what>", "hunk": "<minimal unified diff, version bump included>", "expected_effect": "<tokens | speed | determinism | quality, and why>", "risk": "<what could regress; how it is preserved>"}
  ],
  "applied": [],
  "unresolved": ["<question>"]
}
```

Rules:

- `evidence` is present only with `--evidence`; `scope` is then `evidence`.
- Only `skill-defect` and `agent-mistake` findings may have proposals; every
  proposal names at least one finding.
- `evidence_refs` hold event ids or short session-relative refs, never transcript
  text, tool output, credentials, absolute paths or session ids.
- With `--evidence`, a proposal's lane for an AgentKit core skill is
  `proposal-only`, never `personal-fork`.
- `applied` is always empty. A run with no valid evidence returns empty `findings`
  and `proposals` and names the reason in `unresolved`.
