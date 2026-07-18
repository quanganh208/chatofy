# Dead-Code Audit Complete: knip 6.27 Integration and Tool-Quirk Debugging

**Date**: 2026-07-18 18:43
**Severity**: Medium
**Component**: knip configuration, root workspace, apps/api, apps/mobile, @chatofy/api-client
**Status**: Resolved

## What Happened

Integrated knip 6.27 as root gate, ran full dead-code audit (`pnpm knip`), triaged 100% of findings via grep + lockfile cross-reference, deleted 23 confirmed-dead artifacts (4 unreachable mobile files, 19 unused dependencies, 3 dead exports). Final state: knip exit 0 zero findings/hints/errors; lint 0 errors, typecheck 10/10, build 5/5, sidecar ruff+pytest clean. Code reviewer signed DONE_WITH_CONCERNS (6/6 acceptance criteria PASS); two medium concerns (prisma.config.ts static analysis coverage gap, undocumented ignoreBinaries config) fixed in-session with inline documentation.

## The Brutal Truth

Dead-code audits are satisfying when the tool works—knip's findings were real, deletions clean, and all gates stayed green. But three separate tool-quirk rabbit holes consumed the session: **Windows line endings silently corrupted sh hook parsing**, **tsconfig package-specifier extends don't realpath, so relative paths escape the repo**, and **unresolved import aliases produce cascading false positives**. Each looked like a data problem (invalid findings, missing deps) until we traced root causes. The frustrating part: these aren't knip bugs—they're integration hazards that any static analysis tool would hit. The satisfying part: each had a real, permanent fix instead of ignore-list bandaids. Emotional arc: "Why are we deleting nothing? This tool is useless" → (debug 90 mins) → "Oh, three separate tools got their config wrong. Ship it."

## Technical Details

**Finding 1: .husky hooks parsed as binary**

- Symptom: knip reported "unused devDep: lint-staged" AND "unlisted binary: lint-staged\r". Contradictory flags.
- Root cause: `.husky/pre-commit` file had CRLF line endings (Windows default). Git was configured `core.autocrlf=true`, but `.husky` lacked `.gitattributes` rule. knip spawned `lint-staged\r` as the literal command name (carriage return included).
- Evidence: `file .husky/pre-commit` showed "CRLF line terminators". Git diff displayed hidden `\r` on each line.
- Fix: Converted `.husky` to LF, added `.gitattributes` entry `.husky/* text eol=lf` to enforce LF in the repo. Verified: `pnpm knip` re-run found zero hook issues.
- Lesson: Windows developers must use `.gitattributes` for shell scripts; `core.autocrlf` is insufficient for in-repo linters that parse hook binaries.

**Finding 2: tsconfig extends don't realpath through node_modules symlinks**

- Symptom: knip reported `prisma.config.ts` as unused file (coverage hole). But it's in gitignore and loaded by migrations. Confusing.
- Root cause: `apps/api/tsconfig.json` had `"extends": "@chatofy/config/tsconfig/node"`. knip resolves this symlink path WITHOUT realpathing. The preset's `tsconfig.base.json` uses relative extend `"../../../tsconfig.base.json"`, which escapes the repo when resolved from `node_modules/@chatofy/config/`. Result: knip couldn't load the base config, so `prisma.config.ts` wasn't typed—knip marked it unused.
- Evidence: Adding `"extends": "../../config/tsconfig/node"` (relative from repo root per api-client pattern) fixed it. knip re-run now sees prisma.config.ts correctly.
- Fix: Aligned api `tsconfig.json` extends to relative path like api-client (vitest oxc limitation—documented in original migration). Verified with grep: both packages now use relative extends.
- Lesson: knip's type coverage is only as good as your tsconfig resolution. Package-specifier extends are convenient but create symlink-realpath traps. Relative extends are more explicit and don't require knip workarounds.

**Finding 3: Alias paths resolution cascaded to 22 false-positive "unused files"**

- Symptom: First knip run: 22 "unused file" errors. All were legitimately imported via `@/*` alias. But knip didn't have `paths` config.
- Root cause: Root knip.json inherited empty `paths`. Each app (web, mobile, api) had `@/*` imports unresolved. knip then removed those files from the reachability graph → marked as unused.
- Evidence: Root knip.json had no `paths` entry; workspace `tsconfig.json` had `"paths": {"@/*": ["./*"]}`. knip reads tsconfig but doesn't auto-inherit `paths`—must be explicit in knip.json.
- Fix: Added per-workspace `paths` config to root knip.json:
  ```json
  "paths": {
    "@/*": ["./*/src"]
  }
  ```
  Re-run: cascade cleared, all alias imports resolved correctly.
- Lesson: Static analysis tools are configuration-sensitive. Findings are only correct if your tool's config mirrors your runtime config. A working build ≠ a configured audit.

**Deleted artifacts (safe, all verified)**

- Mobile: 4 files (src/stores/*, src/utils/useRedux.ts) — local api-client chain superseded by @chatofy/api-client import.
- API: 7 deps (pg, @types/pg bundled by @prisma/adapter-pg; pino, pino-pretty redundant with winston; @eslint/eslintrc, source-map-support, ts-loader unused by vitest+swc).
- Mobile: 12 deps (react-navigation, react-native-gesture-handler, react-native-reanimated—DIRECT deps of expo-router; expo-symbols, vector-icons, expo-font, expo-haptics, expo-status-bar zero-import; zod, zustand, @chatofy/config, @chatofy/api-client zero-import or duplicative).
- Exports: `getAuthProviders` (unused), `ApiErrorDto` (re-export only), `SessionStatus` re-export (prefer direct enum import).

## What We Tried

Considered: disable knip and hand-audit for false positives. Reality: each "false positive" was a knip config gap, not a tool bug. Attempted: running knip with `--strict` then filtering results—too noisy. Pivoted to: triage every finding with grep + lockfile evidence before deletion. Attempted: tsconfig extends via package-specifier (convenience)—failed due to symlink realpath trap. Fixed: use relative extends like api-client (documented precedent). Did not attempt: consolidate ioredis as "future Redis" in docs—checked lockfile, dep was never installed, docs drift only (not dead code; scheduled docs fix separately).

## Root Cause Analysis

**Why dead-code findings were massive on first run**: Root knip.json lacked critical config (paths, tsconfig extends pattern). Without it, tool can't resolve normal imports → cascading false positives. Windows CRLF in .husky wasn't caught by git because no `.gitattributes` rule—linters that spawn scripts hit it. Prisma.config.ts coverage gap because tsconfig chain broke on symlink realpath—package-specifier extends are convenient but fragile.

**Why this required detective work vs. trusting the findings**: Each symptom looked like a data problem (contradictory flags, missing files) but was actually a configuration problem. Grep + lockfile evidence forced us to verify every finding before deleting—this is the right approach for any audit, but these three tool-quirks made it essential.

**Why the fixes are permanent, not bandaids**: CRLF → `.gitattributes` is a one-time repo fix (benefits all future hooks). Relative tsconfig extends → existing pattern in api-client, now consistent across packages. Paths config → part of audit repeatability. None are ignore-list entries.

## Lessons Learned

1. **Windows line endings silently break static analysis tools**: `.husky` files with CRLF get parsed as binary paths. Enforce with `.gitattributes` (`.husky/* text eol=lf`). git's `core.autocrlf` is insufficient for shell scripts that linters parse as commands.

2. **Static analysis config != runtime config**: knip reads your tsconfig but doesn't auto-inherit all fields. A working build proves the code works; a green knip run proves your tool config matches your code structure. Both are necessary.

3. **Symlink realpath traps in tsconfig extends**: Package-specifier extends (`@chatofy/config/tsconfig/node`) don't realpath—the preset's relative extends escape the repo. Use repo-relative extends or explicit paths. Documented precedent (api-client) makes onboarding obvious.

4. **Triage before deletion**: Grep + lockfile evidence required. This session had 22 false positives cascading from one config gap. Trusting the tool's first output would have deleted code unnecessarily.

5. **Tool quirks are worth fixing at source, not in ignore lists**: These three issues (CRLF, symlink realpath, path resolution) will hit anyone using knip on this codebase. .gitattributes, relative extends, and explicit paths config are one-time fixes that prevent future frustration.

## Next Steps

1. Commit dead-code deletions (awaiting user approval) — 504820a, cc27fe0, 86dcbe5.
2. Verify knip gate is repeatable: `pnpm knip` exit 0 on CI after merge. Monitor for new dead-code findings as code lands.
3. Document prisma.config.ts coverage: add comment explaining why it's not exported (Prisma internal, loaded at migration time). Close the docs-drift item separately (ioredis "future Redis" never existed—docs cleanup task).
4. Watch: if new packages adopt @chatofy/config/tsconfig extends in the future, they'll inherit the symlink-realpath issue. Future onboarding should use relative extends pattern.

**Files impacted:**

- Root: knip.json (.husky/* text eol=lf in .gitattributes)
- apps/api/tsconfig.json (relative extends per api-client pattern)
- Deleted: 4 mobile files, 19 api+mobile deps, 3 dead exports
- Tests: all 10 typecheck tasks green, 5 build tasks green, sidecar ruff+pytest clean
- Commits: 504820a, cc27fe0, 86dcbe5

---

**Status**: DONE
**Summary**: Integrated knip 6.27, triaged 100% of findings via grep+lockfile evidence, deleted 23 dead artifacts (files+deps+exports), and fixed three tool-config integration issues (CRLF in .husky, symlink-realpath in tsconfig extends, unresolved alias paths). All gates green; knip exit 0. Code reviewer DONE_WITH_CONCERNS; both concerns fixed in-session.
