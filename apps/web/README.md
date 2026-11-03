# web

Chatofy web app — Next.js 16 App Router: landing, translator (`/translate`), video meetings (`/conference`), history, preferences, account.

## Quick start

```bash
pnpm --filter web dev
```

Opens at http://localhost:3001

## Notes

- Reads the repo-root `.env` (copy the root `.env.example`), which needs `AUTH_SECRET` to sign the session cookie. Never create `apps/web/.env*`: see [environment-variables.md](../../docs/environment-variables.md)
- API base URL configured via `NEXT_PUBLIC_API_BASE_URL` (see the root `.env.example`)
- Port 3001 to avoid conflict with the API server on 3000
- Tests: `pnpm --filter web test`
- UI rules: [design-guidelines.md](../../docs/design-guidelines.md)
