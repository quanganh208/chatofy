# Dead-Code Audit — TS Triage Report (knip run 260718)

knip 6.27.0, config `knip.json` (root). Full-run output stable across 2 runs. Every finding below has grep/manifest evidence.

## Verdicts

### DELETE — dependencies (verified redundant)

| Item                                                        | Workspace | Evidence                                                                                             |
| ----------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `pg`, `@types/pg`                                           | api       | `@prisma/adapter-pg` declares both as its OWN deps (checked manifest); api never imports pg directly |
| `pino`, `pino-pretty`                                       | api       | zero imports; only comments "swap for nestjs-pino later" (YAGNI)                                     |
| `@eslint/eslintrc`                                          | api dev   | `eslint.config.mjs` uses flat config, no FlatCompat                                                  |
| `source-map-support`                                        | api dev   | zero references in src/config; Nest CLI carries its own                                              |
| `ts-loader`                                                 | api dev   | `nest-cli.json` has no webpack mode; nest build uses tsc                                             |
| `@react-navigation/native`, `@react-navigation/bottom-tabs` | mobile    | direct deps of expo-router (checked manifest — deps, not peers)                                      |
| `@react-navigation/elements`                                | mobile    | dep of bottom-tabs; no direct import                                                                 |
| `expo-symbols`                                              | mobile    | direct dep of expo-router; no direct import                                                          |
| `@expo/vector-icons`                                        | mobile    | zero imports in app/src                                                                              |
| `expo-font`                                                 | mobile    | only role = peer of vector-icons (being deleted); not in app.json plugins                            |
| `expo-haptics`, `expo-status-bar`                           | mobile    | zero imports; not in app.json plugins                                                                |
| `zustand`                                                   | mobile    | zero imports                                                                                         |
| `@chatofy/config`                                           | mobile    | eslint uses eslint-config-expo, tsconfig extends expo/tsconfig.base, prettier from root              |

### DELETE — code fixes (small, real improvements)

| Item                                                       | Fix                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `express` value-imports (4 src + 1 spec, api)              | convert to `import type` — types satisfied by `@types/express`; clears "unlisted dependency" |
| `envSchema` export (api env.schema.ts)                     | drop `export` keyword (only internal use)                                                    |
| `SessionStatus` re-export (api session-store.interface.ts) | drop `export type {}` line, keep import                                                      |
| `api` export (web src/clients/api-client.ts)               | drop `export` keyword (internal to helpers)                                                  |
| JSDoc `@commitlint/types` line (.commitlintrc.cjs)         | remove annotation (unlisted-dep noise, config is one-liner)                                  |

### KEEP — with knip config (each traceable)

| Item                                                                     | Reason                                                                                                                                            | Mechanism                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `swagger-ui-express` (api)                                               | runtime require of @nestjs/swagger on Express platform (dynamic, invisible to knip)                                                               | ignoreDependencies           |
| `tailwindcss` (web dev)                                                  | used via `@import 'tailwindcss'` in globals.css (knip doesn't parse CSS)                                                                          | ignoreDependencies           |
| `lint-staged` (root)                                                     | used by .husky/pre-commit + .lintstagedrc.json                                                                                                    | plugin config / ignore       |
| `@chatofy/config` (api-client dev)                                       | tsconfig extends `../config/...` relatively BY DESIGN (vitest oxc limitation, documented in tsconfig comment); dep kept to express workspace edge | ignoreDependencies           |
| `expo-updates` unlisted (mobile)                                         | expo plugin quirk — app.json has no updates config                                                                                                | ignoreDependencies           |
| `next` unresolved (packages/config)                                      | tsconfig preset data files reference next TS plugin; presets are data not source                                                                  | workspace ignore tsconfig/** |
| `to-user.mapper.ts` (api)                                                | users persistence stub cluster (locked decision: keep interface-first stubs; mapper documented in plan 260718-1611 non-goals)                     | ignore file                  |
| audio interfaces ×2 (mobile)                                             | locked scaffold decision (plan 260718-1645)                                                                                                       | ignore files                 |
| exports `useAuth`, `useTheme`, `spacing`, `radii`, `typography` (mobile) | auth/theme scaffold consumer surface; providers ARE mounted                                                                                       | `@public` JSDoc tag          |
| exports `buttonVariants`, `CardFooter` (web)                             | shadcn vendored-component convention surface                                                                                                      | `@public` JSDoc tag          |
| type `TranslateTurnOptions` (web)                                        | part of exported hook signature (`runTranslate` param)                                                                                            | `@public` JSDoc tag          |

### ASK — user decision required

1. **Mobile dead chain (4 files):** `src/clients/api-client.ts`, `src/config/env.ts`, `src/config/constants.ts`, `src/hooks/use-auth-providers.ts` — unreachable from app/. Docs say per-app clients RETIRED (replaced by @chatofy/api-client), which contradicts these files existing. Cascade: deleting chain makes `zod` + `@chatofy/api-client` (mobile) unused deps too.
2. **`getAuthProviders`** (web api-client.ts) — documented "smoke-path helper", zero callers.
3. **`ApiErrorDto`** (api envelope.dto.ts) — OpenAPI error model derived from shared schema, not referenced by any decorator yet (sibling ApiMetaDto IS used).

## Phase-4 amendments (post-review)

- **`ignoreBinaries: ["blue,magenta"]`**: knip misparses `concurrently -c blue,magenta` in root `dev:all` script as a binary named `blue,magenta`. Ignore is a parser workaround, not dead config.
- **`.husky` hooks were CRLF** → knip read the binary as `lint-staged\r` (unlisted) AND treated the root devDep as unused. Real fix: converted hooks to LF + added `.gitattributes` (`.husky/* text eol=lf`). No lint-staged ignores needed.
- **`apps/api/tsconfig.json` now extends `../../packages/config/tsconfig/nestjs.json` relatively** (was `@chatofy/config/...`): knip resolves package-specifier extends through the node_modules symlink without realpath, so `base.json`'s `../../../tsconfig.base.json` escaped the repo → load ERROR on `prisma.config.ts` (coverage hole flagged by review). Same precedent as api-client tsconfig (vitest limitation). Consequence: api's `@chatofy/config` dep no longer visible to knip → added to api `ignoreDependencies` (dep kept to express the workspace edge, same reason as api-client).
- Removed 12 knip configuration hints (redundant default entries, no-match ignores). Root workspace pinned to `entry: [] / project: []` — plugins (commitlint, lint-staged, husky, prettier) still run; broad root scan stays off (it previously swept `.claude/` and the Python `.venv`).

## Non-findings (documented)

- `ioredis`: docs claim "Redis via ioredis — future" but NO ioredis dep exists anywhere. Docs drift only → Phase 5.
- Web deps (radix, cva, clsx, tailwind-merge, zod, @chatofy/api-client): all verified used; not flagged after alias config fix.
- Root `.prettierrc.cjs` is self-contained; `@chatofy/config/prettier` preset currently has no consumer (library surface, kept).
