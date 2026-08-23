---
phase: 3
title: 'Mail module and abuse controls'
status: completed
priority: P1
effort: '6-8h'
dependencies: []
---

# Phase 3: Mail module and abuse controls

## Overview

One mail seam with a Gmail SMTP implementation, a console implementation that
makes local development possible without a Gmail account, and the controls that
stop three new endpoints from becoming a mailbombing tool or a product-wide
outage switch.

## Requirements

- Functional: the API can send plaintext mail through Gmail SMTP, and can run
  fully without SMTP configured.
- Functional: abuse controls cannot be bypassed by a caller choosing the wrong
  injection token.
- Non-functional: no boot failure when SMTP is unset; no template engine.

## Architecture

### One seam, not two

`MailModule` exports **only** `MAIL_SENDER`. The cooldown and the send budget are
implemented as a **decorating `MailSender`** bound to that token, wrapping the
concrete sender.

This matters more than it looks. A separate injectable `MailDispatchService`
alongside an exported `MAIL_SENDER` gives callers two reachable seams, and the
house pattern (`AUTH_ADAPTER`, `USER_REPOSITORY`) points a reader straight at the
token. Inject `MAIL_SENDER` and the required cooldown ships **inert with green
unit tests** — the HTTP answer is 202 either way, so nothing downstream notices,
and the first symptom is a Gmail volume lock. `AuthModule` already makes exactly
this argument by exporting `AUTH_ADAPTER` and not `JwtAuthAdapter`.

Same four files, same behaviour, one fewer concept, and the control becomes
unbypassable by construction.

### Senders

- `SmtpMailSender` — nodemailer against `smtp.gmail.com:465`, Gmail **app
  password** (needs 2FA). `From` must be the Gmail address or Gmail rewrites it.
- `ConsoleMailSender` — prints the link. Bound **only** when `NODE_ENV` is
  exactly `development` or `test`. Not `!== 'production'`: `NODE_ENV` defaults to
  `development`, so a staging box or a container with it unset would silently
  print live account-takeover links to stdout, where anyone with log access —
  CI artifacts, an aggregator, a shared terminal — can redeem them. Every other
  value gets a no-op sender plus the loud warning below. Fail closed.

`@nestjs-modules/mailer` is not worth its weight for plaintext mail.

### Mail content rules

**Bodies are built from constants plus the link. No user-supplied text reaches
any part of a mail** — not the body, not the subject, not `To`, `From` or any
header.

This is not hypothetical. `name` is `z.string().min(1)` with no maximum
and no charset restriction, and register mails an address the _caller_ names on
an unauthenticated request. A greeting built from it would let anyone send
`"\n\nSecurity alert: confirm at https://evil.tld\n\n"` to any address, from the
project's own SPF/DKIM-aligned Gmail account, beside a genuine link — 7,200 a day
from one IP. If a greeting is wanted later, add `.max(80)` plus a CR/LF and
control-character strip in the schema **and** re-strip at the mail boundary.

**Dispatch logs carry purpose, outcome and a masked recipient — never the link,
never the token, never the plaintext address.**

### Abuse controls

Three routes send mail to an arbitrary address. **Per-IP throttling bounds none
of it per recipient.**

- **Required — per-recipient cooldown.** In-memory `Map<email, lastSentAt>`;
  drop-and-log a repeat send to the same address inside ~10 minutes. The response
  stays 202 either way, so no oracle changes.

  **Record the cooldown on a _successful_ send, not on dispatch.** A send killed
  mid-flight (there is no SIGTERM drain in `main.ts`, so a deploy kills in-flight
  sends) must not burn the user's window and leave them staring at a UI that
  confirms three sends that never happened.

- **Required — a _tiered_ send budget.** A single global ceiling is an anonymous
  kill switch: an attacker rotating recipient addresses never trips the
  per-recipient cooldown, exhausts the budget in about eighty minutes, and every
  verification and reset mail in the product is silently dropped for the rest of
  the day while all routes still answer 202. Nobody can register or recover, and
  the only trace is a log line.

  So: attacker-triggerable classes (the "you already have an account" notice;
  forgot for an address with no account) draw from a small ceiling of their own.
  Mail for a **user-requested action on a known row** — verification, reset —
  draws from a separate reserved allowance the rotation attack cannot touch.

  Count over a **rolling 24 hours**, maintained by ageing entries out of the same
  structure the cooldown already keeps. Gmail's cap is a rolling window, so a
  calendar-day counter under-protects across midnight, and "~400/day" with no
  reset boundary is not testable.

- Hitting either ceiling raises an **operator-visible alarm**, not a debug line —
  users see 202 regardless, so nothing else surfaces it.

Both rely on the single-instance assumption the in-memory throttler already
makes. In-memory state is lost on restart; accepted, and the reason the budget is
a safety net rather than the primary control.

## Related Code Files

- Create: `apps/api/src/modules/mail/mail.module.ts`
- Create: `apps/api/src/modules/mail/interfaces/mail-sender.interface.ts`
- Create: `apps/api/src/modules/mail/senders/smtp-mail.sender.ts`
- Create: `apps/api/src/modules/mail/senders/console-mail.sender.ts`
- Create: `apps/api/src/modules/mail/senders/guarded-mail.sender.ts` — the
  decorator holding cooldown and budget
- Modify: `apps/api/src/config/env.schema.ts`
- Modify: `apps/api/.env.example`
- Modify: `apps/api/test/setup-env.ts` — it sets only `AUTH_JWT_SECRET` and
  `DATABASE_URL`
- Modify: `apps/api/package.json` (nodemailer + types)

## Implementation Steps

1. Add `nodemailer` and its types.
2. Define `MailSender`; implement both concrete senders and the guarding
   decorator. Export only `MAIL_SENDER` from `MailModule`.
3. Add env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` —
   optional and lazily enforced, per the `GOOGLE_CLIENT_IDS` convention.
4. `WEB_BASE_URL` is the exception: `z.string().url()` with a
   `http://localhost:3001` default (the port `apps/web` actually runs on).

   An unset web origin is a broken link, not an unused feature. Left optional,
   the lazy throw lands inside `void send().catch(log)` and is swallowed while
   the route answers 202 — the user sees success and the console prints
   `undefined/verify-email?token=…`.

   State in the code that **the link origin comes from configuration and never
   from the `Host` header**, so nobody "fixes" a wrong link with
   `req.headers.host` and turns it into host-header link poisoning.

5. Boot check, in production only: refuse to boot — or warn loudly — if SMTP is
   unset **or** `WEB_BASE_URL` is still the localhost default. The default fixes
   dev; it does not fix production, where a plausible-looking wrong origin is
   worse than an obviously broken one, and the SMTP-only warning misses exactly
   the configuration that mails real people.
6. Tests: the cooldown drops a repeat and only after a _successful_ send; the
   tiered budget drops attacker-class mail without touching the reserved
   allowance; the console sender is chosen for `development`/`test` and a no-op
   for anything else.

## Success Criteria

- [x] The API boots with no SMTP configured; production refuses or warns loudly
      when SMTP is unset or `WEB_BASE_URL` is still the default
- [x] The console sender prints a usable link with a real origin — never
      `undefined/…` — with no env configured beyond the defaults
- [x] The console sender is **not** selected when `NODE_ENV` is unset-but-not-development
- [x] A repeat send inside the cooldown is dropped; a killed send does not burn
      the window
- [ ] ~~Exhausting the attacker-class budget does **not** stop verification or
      reset mail for legitimate users~~ — **RENEGOTIATED, half true.** Reset mail
      is protected; verification mail is NOT, because it was reclassified to the
      attacker tier. Register-with-a-fresh-address names an arbitrary recipient
      and creates no row, so leaving it in the reserved tier let an
      address-rotation attacker drain the allowance account recovery depends on —
      the exact failure the tiering exists to prevent. The criterion as written
      cannot hold for both; protecting recovery was chosen. If blocking new
      registrations for the rest of a 24 h window is also unacceptable,
      verification needs a THIRD tier with its own ceiling rather than a return to
      `Reserved`. **Needs the plan owner's decision.**
- [x] No user-supplied text can reach a mail **body**, subject, or header
- [x] No log line contains a link, a token, or a plaintext recipient

## Risk Assessment

**Gmail app passwords disappear.** Google has signalled hostility to them.
Signal: authentication starts failing with no code change. Response: the
`MailSender` seam is the swap point — that is what it is for.

**Deliverability from a consumer Gmail address.** Acceptable at this scale. Do
not chase SPF/DKIM; if mail lands in spam, say so plainly.

**Rollback:** the module has no callers until phase 4.
