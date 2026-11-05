---
title: Mobile auth and translate screens
date: 2026-11-05
summary: 'Mobile gets register, forgot/reset/verify via app links, Google sign-in, a live translate screen and History; not yet run on a device.'
---

# Mobile auth and translate screens

## What happened

Built the mobile UI the app lacked, on branch quanganh208/feat/mobile-auth-translate-ui (plan: plans/261105-1347-mobile-auth-translate-ui).

- Shared kit (Screen, TextField, buttons, sheet) and a route guard: signed-out visitors go to sign-in, a cold start lands on translate.
- Email flows: sign-up, forgot-password, verify-email, reset-password. Mail links open the app because register and forgot-password now send `client: 'web' | 'mobile'` and the API picks between `WEB_BASE_URL` and `MOBILE_LINK_SCHEME`. The request never supplies an origin.
- Google sign-in: the API accepts an allowlist (`AUTH_GOOGLE_ID` plus `AUTH_GOOGLE_MOBILE_IDS`); the app uses expo-auth-session, and `app.config.ts` derives the iOS redirect scheme from the client id.
- Translate: one screen for one-way, two-way and auto-detect, a native speaker sink, a mic lock shared with meetings, and a save to History.
- History: list with search and paging, plus a detail view with delete.

## Verification

Mobile typecheck, lint and 148 tests; i18n 25; types 185; API 1717; web auth specs.

## Surprises

- Mobile reads `@chatofy/i18n` from `dist`, so it must be rebuilt after adding keys.
- A stale `@chatofy/ai-providers` dist failed 222 API tests until rebuilt.
- The i18n shared-keys test forbids web/mobile twin strings, so web.* keys are reused.
- The react-hooks lint rejects mutating refs or state inside render closures (hence a small `SessionEnv` class).
- Typed routes regenerate only while the Expo dev server runs.

## Not verified

Device run, visual check at 375/768 in light and dark, real Google sign-in, single-stream TTS.

## Next steps

Create Google client ids (see docs/environment-variables.md), rebuild the dev client, run the acceptance list on a device. Before a store release, replace the custom scheme with verified app links.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
