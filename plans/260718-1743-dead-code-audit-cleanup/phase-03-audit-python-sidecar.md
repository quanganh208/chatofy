---
phase: 3
title: Audit Python sidecar
status: completed
effort: XS
priority: P3
dependencies: []
---

# Phase 3: Audit Python sidecar

## Overview

One-shot dead-code pass over `services/vieneu-tts` (2 files: `app.py`, `test_app.py`). No permanent Python tooling added.

## Requirements

- Functional: unused imports/variables identified and removed if any.
- Non-functional: no changes to `pyproject.toml`; ruff runs ephemerally via uv.

## Related Code Files

- Modify (only if findings): `services/vieneu-tts/app.py`, `services/vieneu-tts/test_app.py`

## Implementation Steps

1. `uv run --directory services/vieneu-tts --with ruff ruff check --select F401,F841 .`
2. Manual read of `app.py`: any endpoint/function not called by the api's `VieNeuTtsProvider` contract or tests → flag. Cross-check against `packages/ai-providers` VieNeu provider requests (URL paths, params).
3. Remove confirmed dead imports/vars/functions.
4. Verify: `uv run --directory services/vieneu-tts pytest` (sidecar has its own pytest + httpx dev group; this is cheap and local — use it).

## Success Criteria

- [ ] ruff F401/F841 clean
- [ ] No unreferenced endpoints/functions in `app.py`
- [ ] Sidecar pytest green

## Risk Assessment

Minimal — 2 files, local tests exist. Only risk is deleting an endpoint the TS provider calls; mitigated by cross-checking provider request paths first.
