# Codebase Understanding Phase

Skip this phase when scout reports are provided.

- Use `/ak-scout ext` (preferred) or `/ak-scout` to locate the files the task
  needs, and wait for all scout reports before analysis.
- Do not assume a standard documentation corpus. Start from the repository's
  loaded instructions and root README, follow its documentation navigation to
  current development and security rules, architecture maps, requirements, and
  design-system guidance, and verify what they claim against current source,
  tests, manifests, and build configuration. Current implementation evidence
  decides what is actually present.
- If navigation is absent, incomplete, or conflicting, use targeted scouts to
  locate the owning evidence and record the actual paths for the planner.
