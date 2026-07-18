---
phase: 5
title: Docs sync
status: completed
effort: XS
priority: P3
dependencies:
  - 4
---

# Phase 5: Docs sync

## Overview

Fix docs drift found during scout + reflect cleanup results.

## Requirements

- Functional: README/docs describe the actual workspace layout and dependency set post-cleanup.
- Non-functional: no changelog noise; only sections whose claims became false get edited.

## Related Code Files

- Modify: `README.md` (Structure section — add `packages/ai-providers`, `packages/api-client`)
- Modify: `docs/codebase-summary.md` (drop/adjust claims invalidated by cleanup, e.g. Redis/ioredis "future" line if dep removed; note knip in tooling/CI section as available command)
- Modify (conditional): `docs/system-architecture.md` only if a deleted item is named there

## Implementation Steps

1. Read each target doc first (mandated by documentation rules).
2. Update README Structure tree with the two missing packages.
3. Update `codebase-summary.md`: remove references to deleted code/deps; add one line documenting `pnpm knip` + ignore policy for intentional stubs.
4. Verify links/claims match the final state of the repo.

## Success Criteria

- [ ] README structure lists all 6 packages/apps groups accurately
- [ ] No doc references a deleted file/dep
- [ ] `pnpm knip` policy documented in one line

## Risk Assessment

None material — docs-only.
