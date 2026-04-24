# Phase 1 — Monorepo Foundation

**Priority:** P0 (blocks all) | **Status:** pending

## Overview

Bootstrap Turborepo + pnpm workspace at repo root. No apps/packages yet — just the scaffold skeleton.

## Files to Create

### Root configs

- `package.json` — workspace root, scripts (`dev`, `build`, `lint`, `typecheck`), engine pin (node >=20, pnpm >=9)
- `pnpm-workspace.yaml` — declare `apps/*` and `packages/*`
- `turbo.json` — pipelines: `build`, `dev` (persistent), `lint`, `typecheck`, `clean`
- `tsconfig.base.json` — strict TS base for all sub-projects
- `.nvmrc` — `20`
- `.npmrc` — `engine-strict=true`, `auto-install-peers=true`, `shamefully-hoist=false`
- `.editorconfig` — 2-space indent, LF, UTF-8
- `.gitignore` — extend existing (node_modules, .turbo, dist, .env\*, coverage, .next, .expo)
- `.env.example` — placeholder envs for monorepo-wide
- `README.md` — quick start, structure overview
- `LICENSE` — placeholder (defer license decision)

### Git hooks / commit quality

- `.husky/pre-commit` — run `pnpm lint-staged`
- `.husky/commit-msg` — run `commitlint`
- `.commitlintrc.cjs` — extends `@commitlint/config-conventional`
- `.lintstagedrc.json` — lint + format staged files
- `.prettierrc.cjs` — basic config (trailing comma, single quote)
- `.prettierignore` — dist, build, coverage, .next, .expo, .turbo

## Dev Dependencies (root)

`turbo`, `typescript`, `prettier`, `husky`, `lint-staged`, `@commitlint/cli`, `@commitlint/config-conventional`

## Success Criteria

- `pnpm install` succeeds with no workspace members yet (warning OK)
- `pnpm turbo --version` works
- `.husky/` activates on `git commit`
- Existing `.gitignore` + `AGENTS.md` + `CLAUDE.md` preserved
