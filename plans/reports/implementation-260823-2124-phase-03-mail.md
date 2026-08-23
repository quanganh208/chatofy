# Phase 3: Mail module and abuse controls — implementation report

## Files created

- `apps/api/src/modules/mail/interfaces/mail-sender.interface.ts` — `MAIL_SENDER` token, `MailPurpose`, `MailBudgetClass`, `MailDispatch`, `MailSender`, `buildMailContent` (fixed subject/body per purpose, constant + link only). +spec (~30 lines).
- `apps/api/src/modules/mail/senders/console-mail.sender.ts` — dev/test transport, prints to stdout via `console.log` (not Logger — this IS the mail, not an operational log line). +spec.
- `apps/api/src/modules/mail/senders/smtp-mail.sender.ts` — Gmail SMTP via nodemailer, port 465 implicit TLS, `From` defaults to `SMTP_USER`, `MAIL_FROM` is display-name-only override. Plain class, not `@Injectable()` — constructed by a factory only after config is confirmed complete. +spec.
- `apps/api/src/modules/mail/senders/noop-mail.sender.ts` — fail-closed fallback, `logger.warn` on every attempted send. +spec.
- `apps/api/src/modules/mail/senders/guarded-mail.sender.ts` — the decorator: cooldown (10 min, `Map<email, lastSentAt>`), tiered rolling-24h budget (`AttackerTriggerable`=50, `Reserved`=400, exported `BUDGET_CEILINGS`/`COOLDOWN_MS`), header-injection reject (`\r\n` in `to`), `maskEmail` (exported), records cooldown+budget on success only, rethrows on failure. +spec (most thorough — cooldown, budget tiering, aging, alarm-level logging, no-leak-in-logs, header injection).
- `apps/api/src/modules/mail/mail.module.ts` — exports **only** `MAIL_SENDER`; `getSmtpConfig` and `buildInnerSender` exported for direct unit testing (both used by main.ts's boot check too, avoiding a second "are all four set" check). +spec.

## Files modified (exactly the allowed set, nothing else touched)

- `apps/api/src/config/env.schema.ts` — `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM` (all optional, `emptyStringAsUndefined`), `WEB_BASE_URL` (`z.string().url().default(DEFAULT_WEB_BASE_URL)`), exported `DEFAULT_WEB_BASE_URL` const.
- `apps/api/.env.example` — new "Mail (Gmail SMTP)" block, matching existing commentary style.
- `apps/api/src/main.ts` — production-only boot gate: throws before `listen()` if SMTP incomplete OR `WEB_BASE_URL` still the default. Chose **refuse-to-boot**, not warn — mirrors `AUTH_JWT_SECRET`'s "no auth-off mode" precedent; red-team finding #13 was rated High.
- `apps/api/package.json` — `nodemailer@^9.0.5`, `@types/nodemailer@^8.0.1` (checked npm for current versions). `pnpm install` run from repo root, succeeded.
- `test/setup-env.ts` — untouched: no new required var (all mail vars optional/defaulted).

## Design decisions / deviations worth flagging

1. **Purpose vs budget class kept fully decoupled**, per the assignment's literal instruction ("purpose/class must be expressible at the call site"). The phase-3 doc's prose groups "verification, reset" under Reserved and "exists-notice, forgot-for-no-account" under AttackerTriggerable — but re-reading phase 4/5, register's fresh-address branch (which sends the _verification_ mail) is **just as attacker-triggerable** as its taken-address branch (the exists-notice), since both are driven by an unauthenticated caller naming an arbitrary recipient. I did not bake a purpose→class mapping into the mail module; callers (phase 4/5) decide per call site. Flagging this because a literal reading of phase 3's prose could lead phase 4 to wire `VerifyEmail` as `Reserved`, which would let an address-rotation attacker spam the reserved budget via fresh-address registration and defeat the tiering's purpose. Recommend phase 4 classify **both** register branches as `AttackerTriggerable`, and reserve `Reserved` for phase 5's forgot→reset mail (sent only to a row that already exists).
2. **SmtpMailSender is a plain class, not `@Injectable()`** — constructed via factory only once `getSmtpConfig` confirms all four values, avoiding a DI constructor that has nothing to inject in the (common) dev case.
3. **Budget ceilings (50 / 400) are a judgment call**, not specified in the plan. Chosen so their sum (450) sits under Gmail's real ~500/day personal-account cap with headroom — documented inline. Easy to retune, both exported as consts.
4. **Header-injection guard on `to`** (reject on `\r\n`) added as defense-in-depth beyond spec text, since `to` is the one caller-controlled field that must reach a header by necessity.
5. Production boot check chosen as **hard throw**, not a warning — the two options were left open by the phase doc; picked the stronger one consistent with `AUTH_JWT_SECRET`.

## Tests / verification

- `pnpm --filter api test -- mail` → 6 suites, 31 tests, all pass.
- `pnpm --filter api typecheck` → clean (no errors in mail files; one transient error in `auth/purpose-token.spec.ts` seen mid-run belongs to a concurrently-running phase, not present on the next run — not touched by me).
- `npx eslint` on all my files (`src/modules/mail/**`, `src/main.ts`, `src/config/env.schema.ts`) → 0 errors, 0 warnings after fixes.
- Did not run the full suite or e2e suites per instructions (other phases mid-flight).

## Acceptance criteria — self-check

- [x] Boots with no SMTP configured (all optional) — production-only gate added in main.ts.
- [x] Console sender prints a real link, no `undefined` origin (proven by test — sender just prints whatever link it's given; origin correctness is the caller's job via `WEB_BASE_URL`).
- [x] Console sender selected only for `development`/`test` — `mail.module.spec.ts` proves selection for all three `NODE_ENV` values incl. production fail-closed.
- [x] Repeat send in cooldown dropped; killed send doesn't burn the window — both proven with fake timers.
- [x] Exhausting attacker-class budget doesn't touch reserved allowance — proven.
- [x] No user text reaches body/subject/header — `buildMailContent` takes only `(purpose, link)`; `MailDispatch` has no free-text field.
- [x] No log line contains link/token/plaintext recipient — proven by scanning every `Logger.prototype.{log,warn,error}` call's string args.

## MailSender interface (verbatim, for phases 4/5)

```ts
export const MAIL_SENDER = Symbol('MAIL_SENDER');

export enum MailPurpose {
  VerifyEmail = 'verify-email',
  AccountExistsNotice = 'account-exists-notice',
  PasswordReset = 'password-reset',
}

export enum MailBudgetClass {
  AttackerTriggerable = 'attacker-triggerable',
  Reserved = 'reserved',
}

export interface MailDispatch {
  readonly to: string;
  readonly purpose: MailPurpose;
  readonly budgetClass: MailBudgetClass;
  readonly link: string;
}

export interface MailSender {
  send(dispatch: MailDispatch): Promise<void>;
}
```

Usage from `AuthService` (illustrative, not implemented here):

```ts
await this.mailSender.send({
  to: normalizedEmail,
  purpose: MailPurpose.VerifyEmail,
  budgetClass: MailBudgetClass.AttackerTriggerable, // see deviation #1 above
  link: `${webBaseUrl}/verify-email?token=${token}`,
});
```

Inject via `@Inject(MAIL_SENDER) private readonly mailSender: MailSender`. `MailModule` must be imported by whichever module calls this (phase 4's `auth.module.ts`, per plan.md's file list).

## Unresolved questions

1. See deviation #1 — please confirm the intended purpose→budgetClass mapping for phase 4/5 before wiring calls, since the phase-3 prose and the actual attacker-triggerability of `VerifyEmail` (via register's fresh-address path) appear to disagree.
2. Budget ceiling values (50/400) are my judgment call, not spec'd — flag if a different split is wanted.
3. Boot check chose "refuse to boot" over "warn loudly" for production — confirm this is the intended strength; it's a hard `throw` before `app.listen()`.

Status: DONE
Summary: MailModule built with single exported MAIL_SENDER seam wrapping SMTP/console/no-op senders in a GuardedMailSender enforcing per-recipient cooldown and tiered rolling-24h budget; env/main.ts/.env.example/package.json updated per allowed scope; 31 tests pass, typecheck and lint clean.
Concerns/Blockers: none blocking; see unresolved questions above for phase 4/5 to confirm before wiring calls.
