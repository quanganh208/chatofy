# Web CLI Rewire Report

## Files Modified

- `apps/web/package.json` — workspace deps, zod, port 3001, typecheck script
- `apps/web/next.config.ts` — reactStrictMode, transpilePackages, typedRoutes
- `apps/web/tsconfig.json` — extends @chatofy/config/tsconfig/nextjs.json; overrides composite/declaration; paths @/_ → ./src/_
- `apps/web/app/layout.tsx` — Chatofy metadata, no Geist font
- `apps/web/app/page.tsx` — minimal landing placeholder
- `apps/web/app/globals.css` — minimal reset + system font + dark mode
- `apps/web/README.md` — quick start, port note

## Files Created

- `apps/web/.env.example`
- `apps/web/src/config/env.ts` — zod-validated WebEnv
- `apps/web/src/clients/api-client.interface.ts` — IApiClient mirror
- `apps/web/src/lib/.gitkeep`

## Files Deleted

- `apps/web/app/page.module.css` — orphaned after page.tsx rewrite

## Files Preserved (untouched)

- `apps/web/next-env.d.ts`, `apps/web/app/favicon.ico`, `apps/web/.gitignore`, `apps/web/public/*`

## Notes

- `@chatofy/config/tsconfig/nextjs.json` exports verified in package.json
- tsconfig locally overrides `composite: false`, `declaration: false` to prevent conflict with base.json
- `AGENTS.md` / `CLAUDE.md` absent at apps/web root — no cleanup needed
