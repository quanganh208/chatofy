---
title: 'Phase 6: Mobile auth client'
status: deferred
priority: P3
effort: '2-3d'
dependencies: [5]
---

# Phase 6: Mobile auth client

## Overview

**Deferred by user decision.** The extension is no longer part of this phase — its
token wiring moved into Phase 3, because leaving a shipped MV3 extension unable to
reach an enforcing API for an indefinite period was not an acceptable consequence
of a deferral. What remains here is mobile.

## Scope revision

`apps/mobile` is **not greenfield**. It already ships `AuthProvider` + `useAuth`
(`src/providers/auth-provider.tsx`, wired into `app-providers.tsx`), an `AuthClient`
interface typed against the shared `AuthSession`, and a throwing `StubAuthClient`.
`AuthClient` maps 1:1 onto `POST /auth/login` and `/auth/register`, both of which
return exactly `AuthSession` — good evidence the shared contracts were right.

**The cheap part shrank; the expensive part did not.** Outstanding:
`expo-auth-session` native Google flow, per-platform client ids in Cloud Console,
SecureStore persistence, and device QA. That is why web-first holds.

Note mobile currently has **no api-client module at all** (`src/clients/` contains
only the auth interface and stub), so token wiring there is new construction, not a
modification. Exact paths are deliberately not enumerated: a deferred phase's file
list goes stale, and this one already did.

## Requirements

- [ ] Real `AuthClient` replacing `StubAuthClient`
- [ ] Token persisted in `expo-secure-store`
- [ ] Native Google via `expo-auth-session`, posting its id_token to the existing `POST /auth/google`
- [ ] Mobile api-client instance carrying the token

## Success Criteria

- [ ] Mobile login persists across app restarts
- [ ] Native Google id_tokens verify against the **existing** Phase 4 endpoint with no server change

## Risk Assessment

**Per-platform Google client ids differ from web's.** Mitigated in Phase 4, whose
audience allowlist is a `string[]`. If a server change turns out to be needed, that
is the signal Phase 4 shipped it as a single value.
