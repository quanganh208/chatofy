# web

Chatofy web app — Next.js 16 App Router: landing, translator (`/translate`), video meetings (`/conference`), history, preferences, account.

## Quick start

```bash
pnpm --filter web dev
```

Opens at http://localhost:3001

## Notes

- Env file `apps/web/.env.local` needs `AUTH_SECRET`, which signs the session cookie (copy `.env.example`)
- API base URL configured via `NEXT_PUBLIC_API_BASE_URL` (see `.env.example`)
- Port 3001 to avoid conflict with the API server on 3000
- Tests: `pnpm --filter web test`
- UI rules: [design-guidelines.md](../../docs/design-guidelines.md)
