# Review checklist

Cover correctness, security, performance, breaking changes and tests. Breaking changes
include API shape or status-code changes, schema changes without migrations, config format
changes without backward compatibility, and removed or renamed public exports. For tests,
check that new paths are covered and watch for phantom coverage (assertions that always
pass).

**Code quality (anti-slop, terse checklist)**
LLM-assisted PRs often add code that runs fine but degrades the codebase. Scan the diff for:

- New file in dumping-ground dirs (`utils/`, `helpers/`, `lib/common/`, `*manager.ts`) without a clear domain anchor
- Parallel reimplementation of a utility that already exists in the repo (grep for prior art)
- New abstraction (interface + factory + builder) with only one caller
- New config flag for behavior that should be hardcoded
- Defensive paranoia: try/catch around code that cannot throw; null checks on typed-non-null params
- Catch-and-swallow: `catch (e) { console.log(e) }` or `catch { return null }`
- Re-implementing stdlib (`chunk`, `range`, `groupBy`) when the language or an existing dep covers it
- `any` widening, `@ts-ignore`, `// eslint-disable` introduced to silence (not fix) warnings
- File grows past the project's size limit without splitting
- Diff size doesn't match scope ("fix typo" with +800/−60), or touches files unrelated to the stated purpose

**Load the full taxonomy** in `references/anti-ai-slop.md` when ANY of:
- diff adds >300 lines, OR
- ≥2 inline anti-slop flags above fire, OR
- PR creates >2 new files in `utils/`/`helpers/`/`lib/common/`, OR
- you cannot confidently judge whether a pattern is genuine YAGNI vs slop

**Project-specific compliance**
- Find the project's review standards through its loaded instructions and documentation navigation
- Verify every cited rule against the current path, source, tests, or configuration that owns it
- Check the diff against those conventions (architecture patterns, ID scoping, data-store rules, i18n catalogs, UI conventions, package manager, file-size limits)
