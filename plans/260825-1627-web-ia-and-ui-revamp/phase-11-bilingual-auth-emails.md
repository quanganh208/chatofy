---
title: 'Phase 11: Bilingual auth emails'
status: done
priority: P2
dependencies: [10]
---

# Phase 11: Bilingual auth emails

## Overview

Make the four auth emails follow the recipient's language. This is the only phase that
touches `apps/api` and the database schema.

## Requirements

- [x] All four mail purposes render in Vietnamese and English
- [x] A user's locale is persisted and used for mail addressed to them
- [x] The one purpose with no user row falls back to the requesting locale
- [x] The migration is additive and backfills safely

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

- [x] `pnpm --filter @chatofy/api test` green
- [x] All four templates render in both locales — asserted, not eyeballed
- [x] A spec asserts `NoAccountNotice` uses the request locale and does not consult a user row
- [x] A spec asserts neither forgot-password branch performs an extra awaited operation
- [x] An unsupported `locale` on the request coerces to the default on both branches without throwing
- [x] `pnpm --filter @chatofy/types build` green — the DTO change is a shared contract
- [x] Registering with a VI browser produces a Vietnamese verification mail
- [x] Changing mail language in Preferences changes the next reset mail
- [x] `prisma migrate deploy` applies cleanly on a copy of the existing database
- [x] Existing rows read `locale = "en"` without a backfill
- [x] The dev console sender (`SMTP_*` unset) prints the localized copy

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

## Deviations from the plan

**Mail language is bound to the UI language, not a separate control.** The plan offered
both and said to record whichever was chosen. Two language settings a user has to
reconcile is a worse product than one, on a tool with a single language pair, and the
failure separability prevents — mail arriving in a language you did not pick — is not a
failure anyone has here. So `LocaleSwitcher` writes the cookie AND, when there is a
session, `User.locale`. The field is not ignored: one control sets both. The write is
fire-and-forget, because blocking a language switch on a round trip would make it feel
like a save, and a failed write leaves the UI language changed — which is what the click
asked for.

**The Preferences Interface card gained the same switcher rather than a second one.**
Phase 8 left that row shaped and empty on purpose. It is filled now, with the component
the chrome already renders.

**`PendingRegistration` carries the locale through the registration token.** The plan
said to carry it on the register payload and persist it with the row; between those two
points sits a mailed link that may be redeemed a day later, and there is nowhere else to
keep it. Unlike the password hash it is not sealed: it is one of two public strings, and
anyone who can read the token can already read the address it is for. A token minted
before this claim existed falls back rather than being refused — invalidating every link
already in a mailbox for the sake of a preference would be the wrong trade.

**`GET /auth/me` now returns `locale`,** which the plan did not call for. It is on
`UserRecord` rather than beside the password hash because, unlike that, it is safe and
useful in a response: a settings screen has to be able to show what it is set to. The
output schema keeps it a permissive `string` for the same reason `email` is one — a row
written by a newer build must still parse on an older client.

**`requestLocaleSchema` uses `catch`, not `default`.** `default` only fills an ABSENT
value, so `{ locale: 42 }` would still throw — and a throw is precisely what these two
routes cannot afford: they answer identically for every address, and a schema error on
one request and a 202 on another is a difference an attacker produces at will. `catch`
swallows the wrong type too. `PATCH /auth/me` is strict instead, and that asymmetry is
the point: an authenticated user changing their own setting learns something true from a
400, and it leaks nothing about anyone else.

**A spec the plan did not list caught the new field.** `registration.service.spec.ts`
asserts the exact key set of a dispatch — "the interface has no field for free-form text
at all… this assertion is what notices if one is ever added" — and it noticed. `locale`
is on the list now with the reason: it is one of two enum values narrowed at the DTO
boundary, it reaches no header and no body, and the senders use it to CHOOSE a fixed
template rather than to compose one.

## Verification

`pnpm --filter api test` 568/568 (42 files, from 551/41), `typecheck` clean,
`eslint src/**/*.ts` 0 errors and the 2 pre-existing warnings.
`pnpm --filter web test` 442/442, `typecheck` clean, `build` green.
`pnpm --filter @chatofy/types build` green — the DTO change is a shared contract.

**The database was backed up first**, per the repo rule: `pg_dump` of `chatofy` to the
session scratchpad before the schema changed.

**`migrate deploy` on a copy.** The dump was restored into a scratch database and
`prisma migrate deploy` run against it: three migrations found, the new one applied, all
successful. The pre-existing row read `locale = en` afterwards with no backfill. Scratch
database dropped.

**End to end, against a running api with the console sender:**

| Step                                                           | Result                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| `POST /auth/register` with `locale: "vi"`                      | Vietnamese verification mail; `locale":"vi"` in the token |
| `POST /auth/verify-email`                                      | row created with `locale = vi`                            |
| `POST /auth/forgot-password` with `locale: "en"`               | **Vietnamese** reset mail — the ROW's language            |
| `POST /auth/forgot-password` for an unknown address, `vi`      | Vietnamese no-account notice — the REQUEST's language     |
| register `en` → `PATCH /auth/me` to `vi` → reset asked in `en` | **Vietnamese** reset mail                                 |
| `PATCH /auth/me` with `locale: "xx"`                           | `400`                                                     |
| `PATCH /auth/me` with no token                                 | `401`                                                     |

The two accounts this verification created were deleted afterwards; the dev database is
back to its one pre-existing row.

**Not verified: a real SMTP delivery.** No `SMTP_*` is configured here, so the Vietnamese
subject lines were exercised only through the console sender. Nodemailer encodes a
non-ASCII subject as MIME words on its own, but the plan asked for one real delivery and
this is not it — mojibake in a real client is exactly the failure a console sender cannot
show. It stays open.

## What Phase 12 inherits

- `docs/design-guidelines.md` § Copy register gains the four decisions Phase 10 made and
  this phase applied to mail: per-locale review, the reviewer test, locale-dependent
  language names, and "bạn".
- The `User.locale` column and `PATCH /auth/me` are new public surface — the API and
  architecture docs describe neither yet.
- One open risk to carry into the docs: the SMTP delivery above.
