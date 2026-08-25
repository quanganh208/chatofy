---
title: 'Phase 11: Bilingual auth emails'
status: todo
priority: P2
dependencies: [10]
---

# Phase 11: Bilingual auth emails

## Overview

Make the four auth emails follow the recipient's language. This is the only phase that
touches `apps/api` and the database schema.

## Requirements

- [ ] All four mail purposes render in Vietnamese and English
- [ ] A user's locale is persisted and used for mail addressed to them
- [ ] The one purpose with no user row falls back to the requesting locale
- [ ] The migration is additive and backfills safely

## Architecture

### The seam is already clean

All four templates live in one place:
`apps/api/src/modules/mail/interfaces/mail-sender.interface.ts`, as

```ts
const MAIL_CONTENT: Record<MailPurpose, (link: string) => { subject: string; text: string }>;
```

over `MailPurpose.VerifyEmail`, `AccountExistsNotice`, `NoAccountNotice`,
`PasswordReset`. `AuthMailer` is a dispatcher and carries no copy.

The change is a second argument:

```ts
Record<MailPurpose, (link: string, locale: Locale) => { subject: string; text: string }>;
```

and `locale` added to `MailDispatch`.

### Where the locale comes from, per purpose

| Purpose               | Source                    | Note                                                                                                                                     |
| --------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `VerifyEmail`         | the registration request  | No `User` row has a locale yet at mint time — it is being created. Carry the locale on the register payload and persist it with the row. |
| `PasswordReset`       | `User.locale`             | The row exists.                                                                                                                          |
| `AccountExistsNotice` | `User.locale`             | The row exists — that is what the notice is about.                                                                                       |
| `NoAccountNotice`     | **the requesting locale** | By construction there is no row. This is the one that will be got wrong.                                                                 |

`NoAccountNotice` exists so that "forgot password" answers identically whether or not an
account exists. Its locale must therefore come from the request and **must not** branch
on whether a user was found — a language difference between the two responses would
re-introduce the account-enumeration signal the notice was built to remove.

Three further rules, because the service's own docblock stakes uniformity on **response
time** ("indistinguishable in status, body and — because the send is detached — in
response time"):

1. **No second awaited query in the found branch.** `forgotPassword` already holds the
   row: `password-reset.service.ts:75` does `const found = await
this.users.findCredentialsByEmail(email)`. Take the locale off `found.user`, extending
   the repository's return type if needed. An extra awaited lookup only in the found
   branch runs _before_ the return, so the detached mail send does not hide it — it is a
   measurable timing delta and therefore an oracle.
2. **Validate the request locale before the branch.** It is attacker-controlled; coerce
   an unknown value to the default at the DTO boundary, identically for both branches, so
   an unsupported string cannot throw on one path and not the other.
3. **The HTTP body stays one constant.** `RESET_REQUESTED` is returned identically today.
   If it is ever localized, it must key on the **request** locale — keying on the stored
   locale rebuilds the oracle in the response body.

Mail content may differ per purpose and per recipient: that channel reaches the mailbox
owner, not the requester, so it carries no signal back to an attacker.

### Schema

```prisma
// The language this account's mail is written in. Set at registration from the
// browser's negotiated locale and changed from Preferences. Not a display setting —
// the web UI's language lives in a cookie; this exists because mail is sent when
// no browser is present to ask.
locale String @default("en")
```

`String` with a default, not an enum: the api validates against the supported set at the
boundary, and an enum migration for two values that may grow is more ceremony than it
earns. Default `"en"` so existing rows are valid without a backfill query.

Per the repo rule, **back up the database before applying the migration**, even though
it is additive.

### Web side

- The register form sends the current locale.
- `/preferences` gains a control for mail language, defaulting to the UI language but
  separately settable — a user may read the UI in English and want mail in Vietnamese.
  If that feels like over-design, bind it to the UI language and record the decision;
  do not silently ignore the field.
- Requires a `PATCH /auth/me` or equivalent to change it. Check whether one exists
  before assuming; `auth.controller.ts` currently exposes `GET /auth/me` only, so this
  is likely a new endpoint.

## Related Code Files

- Modify: `apps/api/prisma/schema.prisma` — `User.locale`
- Create: `apps/api/prisma/migrations/<timestamp>_add_user_locale/`
- Modify: `apps/api/src/modules/mail/interfaces/mail-sender.interface.ts` — `MAIL_CONTENT`, `MailDispatch`
- Modify: `apps/api/src/modules/auth/registration.service.ts`, `password-reset.service.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts` — locale on register; an update endpoint
- Modify: `packages/types` — `RegisterRequest`, `ForgotPasswordRequest`, and the update-me DTO live there; this is a shared contract change requiring a rebuild
- Modify: `apps/api/src/modules/auth/user.repository.ts` (or equivalent) — `findCredentialsByEmail` must return the locale
- Modify: `apps/web/src/components/auth/register-form.tsx` — send the locale
- Modify: `apps/web/app/(app)/preferences/page.tsx` — mail language control
- Modify: the mail sender specs

## Implementation Steps

1. **Back up the database.**
2. Add `User.locale` and generate the migration; apply with `prisma migrate deploy`.
3. Widen `MAIL_CONTENT` to take a locale and write the Vietnamese half of all four
   templates.
4. Add `locale` to `MailDispatch` and thread it from each call site.
5. Resolve the locale per the table above — `NoAccountNotice` from the request, never
   from a lookup.
6. Carry the locale on registration; add the update endpoint and wire Preferences.
7. Extend the mail specs to cover both locales, and assert that the two forgot-password
   branches are indistinguishable in shape, language, **and awaited work** — neither
   branch performs an extra awaited operation.
8. Run api and web tests.

## Success Criteria

- [ ] `pnpm --filter @chatofy/api test` green
- [ ] All four templates render in both locales — asserted, not eyeballed
- [ ] A spec asserts `NoAccountNotice` uses the request locale and does not consult a user row
- [ ] A spec asserts neither forgot-password branch performs an extra awaited operation
- [ ] An unsupported `locale` on the request coerces to the default on both branches without throwing
- [ ] `pnpm --filter @chatofy/types build` green — the DTO change is a shared contract
- [ ] Registering with a VI browser produces a Vietnamese verification mail
- [ ] Changing mail language in Preferences changes the next reset mail
- [ ] `prisma migrate deploy` applies cleanly on a copy of the existing database
- [ ] Existing rows read `locale = "en"` without a backfill
- [ ] The dev console sender (`SMTP_*` unset) prints the localized copy

## Risk Assessment

**`NoAccountNotice` leaks account existence through language.** If it resolves locale by
looking up the user, a request for a non-existent address falls back to a default while a
real one uses the stored preference — and the language difference is an enumeration
oracle. Signal: any user lookup in that path. Response: it takes the request locale
unconditionally; a spec asserts it.

**The migration runs against a database that predates the squash.** README documents
that such a database still carries old migration history and `migrate deploy` refuses.
Signal: the "migrations applied but missing from the local directory" error. Response:
that is a pre-existing condition with a documented fix in the README; do not work around
it inside this migration.

**Mail language and UI language drift into two settings nobody understands.** Signal: a
user changes the UI to Vietnamese and still gets English mail with no explanation.
Response: default mail language to the UI language at registration and on change, and
only keep them separable if that stays genuinely useful — otherwise bind them and record
why.

**Vietnamese subject lines break the SMTP path.** Non-ASCII subjects need proper MIME
encoding. Signal: mojibake in a real client, which the console sender will not reveal.
Response: verify once against a real SMTP delivery, not only against
`console-mail.sender.ts`.
