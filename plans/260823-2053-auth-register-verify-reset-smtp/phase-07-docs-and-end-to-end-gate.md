---
phase: 7
title: 'Docs and end-to-end gate'
status: in-progress
priority: P2
effort: '5-7h'
dependencies: [6]
---

# Phase 7: Docs and end-to-end gate

## Overview

Reconcile every claim this work falsifies, then run the full gate. Several
comments and documents assert things the code no longer does — leaving them is
worse than never having written them.

## Every falsified claim, enumerated

Grep-verified, not assumed. A partial list is how a repo ends up asserting both
"revocation exists" and "there is no revocation" a file apart.

| Location                                                                               | Claim now false                                                                                                         |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/auth/adapters/jwt-auth.adapter.ts:53-54`                         | "NOT a revocation path… `verifyToken` never reads the database" — **note this string is in the adapter, not the guard** |
| `apps/api/src/modules/auth/auth.service.ts:123-125`                                    | Register's 409 existence oracle "recorded rather than left to look like an oversight"                                   |
| `apps/api/src/modules/auth/auth.service.ts:177`                                        | "email verification is an explicit non-goal"                                                                            |
| `apps/api/src/modules/auth/auth.service.ts:183`                                        | "With revocation a non-goal, noticing does not end it: their token runs its seven days out"                             |
| `apps/web/next.config.ts:6`                                                            | "a seven-day, **non-revocable** bearer credential" — load-bearing, it is the CSP rationale                              |
| `apps/web/src/components/layout/session-menu.tsx:15`                                   | "there is no revocation, by decision, so this is a local sign-out"                                                      |
| `apps/api/src/modules/auth/auth.service.spec.ts` + `apps/api/test/auth.db-e2e-spec.ts` | 409/201 register assertions and their explanatory comments                                                              |
| `docs/system-architecture.md:319`                                                      | "There is **no revocation of any kind**… a password change does nothing to an issued token"                             |
| `docs/system-architecture.md:386,390-391`                                              | The related token-lifetime narrative                                                                                    |
| `docs/codebase-summary.md:93`                                                          | `AUTH_JWT_SECRET` rotation as "the only revocation this design has"                                                     |

Each is owned by the phase that falsifies it — the adapter by phase 2, the
service and spec comments by phase 4 and 5 — but this phase is where the sweep
proves none was missed.

`docs/design-guidelines.md` needs nothing: no new primitive was added.

## Mobile and extension — verified, not assumed

- `apps/mobile` makes **no** `/auth/` calls; its auth client is a stub. Its
  `signUp(): Promise<AuthSession>` type is corrected in phase 4.
- `apps/extension` calls only `/auth/login` (`access-token.ts:52`) and passes the
  API's own `error.message` through to the popup, so it needed no change for the
  register contract. Its 401-clears-token handling lands in phase 2.

Record this, or the next person reads "register's contract changed" and hunts for
extension work that does not exist.

## Docs to update

- `docs/system-architecture.md` — rewrite the Tokens section honestly: what
  revocation now exists, what it costs per request, that open sockets are closed
  on a password change, and what still is not covered (a token stays valid for
  its seven days if the password never changes — there is still no
  logout-everywhere). Add `MailSender` and the verification flow to the owner
  table.
- `docs/codebase-summary.md` — the new env vars; correct the revocation sentence.
- `apps/api/.env.example` — SMTP block + `WEB_BASE_URL`.
- `README.md` — one line: the console sender prints links, so no Gmail account is
  needed in dev.

## Implementation Steps

1. Read each document before editing; **correct** claims in place rather than
   appending. A section asserting both positions is worse than either alone.
2. Work the table above top to bottom.
3. Update the env documentation in both places that list env.
4. Run the full gate:
   ```bash
   pnpm --filter @chatofy/api test
   pnpm --filter @chatofy/api test:e2e
   pnpm --filter @chatofy/api test:e2e:db
   pnpm --filter @chatofy/web test
   pnpm lint && pnpm typecheck && pnpm build
   ```
5. Manual pass against the console sender: register → verify → sign in → forget →
   reset → sign in, plus a WebSocket translate session **open across** a reset, to
   confirm the socket is closed in a real browser rather than only in a test.
6. Sign in to the extension popup, reset the password on web, and confirm the
   popup stops claiming "signed in" — the one cross-app behaviour this work
   changes.
7. Record one manual timing measurement of register's two branches in the
   implementation report. Deliberately not a CI gate — see phase 4.

## Success Criteria

- [x] `grep -rn "non-goal\|revocation\|non-revocable" apps packages docs` returns
      no false claim
- [x] Every new env var is documented where the others are
- [x] The full gate passes
- [ ] The manual browser pass completes, including socket closure across a reset
      and the extension check — **NOT DONE: needs a human at a browser**
- [ ] `ak plan status` shows all phases complete

## Risk Assessment

**Docs are updated by appending rather than correcting.** Signal: a diff that
only adds lines to the Tokens section. Response: the old sentences must go.

**The manual pass is skipped because tests are green.** Socket closure and the
extension's behaviour are the two paths whose real-browser shape differs enough
from the harness to be worth checking by hand once.
