# Credits and billing

> **Status: built, owner-only.** Every account has a credit balance, and live translation
> and minutes spend it. Checkout runs on Polar and SePay, but only for the accounts in
> `BILLING_CHECKOUT_ALLOWLIST`. Everyone else sees the plans and their own balance, and
> the buy actions are disabled with an explanation. Nothing is sold to the public; the
> [go-live checklist](#go-live-checklist) lists what would have to change first.

## Why it is owner-only

Selling minutes would breach a licence. The production Vietnamese STT model,
Zipformer-30M, is CC-BY-NC-ND-4.0 and licensed for academic and thesis use only
([README → Model licences](../../README.md#model-licences)). That licence is why billing
was deferred in
[video-conferencing-architecture.md → Decision 3](../video-conferencing-architecture.md#3-billing-vs-a-non-commercial-thesis--per-minute-credits-built-conference-billing-tables-deferred-issue-212).
The owner then chose to build the whole flow, with real money allowed only from the
owner's own accounts.

The allowlist matters in sandbox as well as live. Without it, anyone on production could
pay with a test card, get 600 Pro credits for nothing, and spend the shared translation
quota.

## The unit

1 credit = 1 minute of translated captions. The ledger stores and moves **integer
credit-seconds** (60 per credit); a credit is only a display unit. The constants are in
`apps/api/src/modules/credits/credit-pricing.ts`, and the conversion is
`CREDIT_SECONDS_PER_CREDIT` in `packages/types/src/http/billing.ts`.

| What is charged                           | Price                                         | Why                                                                                                                                                                     |
| ----------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/ws/translate` audio                     | accepted seconds × (1 + extra targets) × mode | Each extra target is another translation of the same speech. Mode is 1 for captions and 2 for voice output; local TTS costs no money, so 2× stands in for its capacity. |
| A minutes run (conversation or meeting)   | 3 credits flat, refunded if the pass fails    | The summarization cost is not measured yet, so this is an estimate.                                                                                                     |
| Titles, meeting chat, block retranslation | not metered                                   | Included in every plan rather than priced separately.                                                                                                                   |
| `POST /translate` (one REST turn)         | not charged, but gated                        | Refused with 402 `CREDITS_EXHAUSTED` under one credit available, 503 when the balance cannot be read, and throttled to 20 per minute per account.                       |

Examples: captions into one language cost 1 credit a minute, voice into one costs 2,
and voice into three costs 6.

- **Only accepted seconds are charged.** `pushFrame` returns the seconds it took into
  the turn's buffer. A frame it refuses (busy, wrong format, no session) costs nothing.
- **In a meeting, the speaker pays.** A speaker's leg is the connection that sends
  `alsoTranslateInto`, so it pays for every extra target. Listeners open no
  `/ws/translate` and pay 0. For meeting minutes, the participant who asks for them pays.
- **Admission is priced high and the turn is priced right.** The start check uses the
  multiplier of every requested target. The settle uses the extra targets that `start()`
  actually ran.
- **A muted language bills captions.** Voice is per language
  (`sessionOptions.voiceByLanguage`). Admission counts a start as voiced when ANY
  language it may speak is unmuted, since a two-way turn's language is known only once
  heard; at settle, a turn whose every voiced language was muted is repriced down to the
  caption rate (`TranslationMeter.repriceTurn`, which only ever lowers). A start with
  every language muted is priced as captions from the start.

The plans are rows in the `Plan` table, seeded by
`apps/api/prisma/migrations/20261109114047_add_credits_ledger/migration.sql`. That table
is the price authority, and `/pricing` and `GET /billing/plans` read it (the web server
reuses a fetched list for 60 s, so page renders do not share out the API's per-IP throttle). In short:

- Free: 120 credits a calendar month, Asia/Saigon time, with no rollover.
- Pro: 600 credits a cycle. On Polar it is a monthly subscription; on SePay it is a 30-day
  pass, because bank transfers cannot auto-renew.
- Top-ups: never expire.

### What a minute costs

Production read-out, 2026-11-09:

- **The call-budget arm** comes from the API's boot line:
  `speculationOverlap=off speculationHomophones=off liveCommitScale=3`. To read it:
  `docker logs chatofy_prod_api 2>&1 | grep "cost policy:" | tail -1`.
- **Production $/min is not measured yet.** LLM calls are now recorded as
  `LlmCallRecord` rows, but the log since that boot had 0 `llm kind=` lines, so there was
  no traffic to measure. Once there is, `credits:cost-report` gives the figure.

Until then, the prices rest on figures from the 2026-11-09 pricing research. They are
estimates and were never measured on production:

| LLM translation cost per audio minute | Source                                                    |
| ------------------------------------- | --------------------------------------------------------- |
| $0.0047                               | research arm s3, DeepSeek Flash at its peak rate          |
| $0.0088                               | baseline arm                                              |
| $0.0126                               | worst Flash-class case: Gemini 3.5 Flash-Lite at baseline |

Pro is sized on the worst case: 600 × $0.0126 = $7.56, plus a Polar fee of about $1.15,
stays under $9.99. A 1,200-credit Pro would not. The same arithmetic is why Free is 120 a
month and not 10 minutes a day: about 300 a month would cost $3.78 per heavy free user at
the worst case.

## Ledger

The ledger is eight tables in `apps/api/prisma/schema.prisma`. Like every other user
column there, each `userId` is a plain indexed column with no relation and no cascade.

| Model           | Role                                                                                                                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Plan`          | What can be bought and on which rail.                                                                                                                                                                    |
| `CreditGrant`   | A batch of credit: Free, subscription, pass, top-up, promo or refund. `amount > 0` and `0 ≤ remaining ≤ amount` are CHECK constraints. `externalRef` is unique: it is the idempotency key for the grant. |
| `CreditLease`   | Credit held by a live `/ws/translate` connection. `0 ≤ consumed ≤ held` is a CHECK constraint.                                                                                                           |
| `CreditEntry`   | The journal, append-only. Every movement has a unique `idempotencyKey`. Settle entries carry `sessionId`, plus `conversationId` when the client sent one.                                                |
| `Subscription`  | Polar subscription state, and the SePay pass period (one row per user).                                                                                                                                  |
| `PaymentOrder`  | A SePay QR order, or a paid SePay transfer or Polar order waiting for owner review (`needs_review`).                                                                                                     |
| `WebhookEvent`  | One row per verified delivery, unique on (provider, event id).                                                                                                                                           |
| `LlmCallRecord` | One row per LLM call, with tokens, model, `userId` and `sessionId`. It is the cost side of the report.                                                                                                   |

**Every write takes the user's lock.** Writes run in a bounded transaction (2 s
`maxWait`, 5 s timeout, `SET LOCAL lock_timeout '2s'`) and then take
`pg_advisory_xact_lock(hashtext(userId))`, in `ledger-transaction.ts`. A timeout surfaces
as `LedgerUnavailableError`, so a slow database cannot hold a Prisma pool connection for
long. Twenty parallel spends on one user never take a grant below 0 (proven in
`apps/api/test/credits-ledger.db-e2e-spec.ts`).

**One account cannot take the pool.** A transaction waiting on a user's lock still holds
a pool connection (`max: 20`), so the meter runs at most two ledger transactions per
account and queues the rest in memory (`user-ledger-gate.ts`). It refuses a start
with `too_many_turns` when three starts of that account already wait on the ledger
(transient: clients keep the audio and retry it, where a credit code ends the run),
and the gateway runs the in-memory turn ceilings before the credit admission, so a
start they refuse costs no transaction. `GET /billing/me` takes no lock: it reads one
REPEATABLE READ snapshot and leaves due grants out instead of expiring them.

**Spend order.** A spend takes the soonest-expiring grant first, with never-expiring
grants last. When expiry ties, free credit goes before paid, then the oldest grant
first (`credit-spend.ts`). This order means credit that is about to expire is used up
first, so a top-up is spent only when nothing that expires is left.

**The Free grant is written lazily.** The first ledger read or lease of a Saigon month
writes it, keyed `free:<userId>:<YYYY-MM>`, so concurrent reads write one row (the
read path writes it outside the lock; the unique key is what makes that safe). No Free
grant is written while a Pro period is live, which is what keeps Pro's worst case
positive: 600 credits fit under the price, 720 would not. A Polar subscription that is
`active` or `trialing` and not set to cancel counts as Pro for 48 h after its stored
period end, so a read between the period end and the renewal's `order.paid` does not
mint Free (`free-grant.ts`).

### Lease lifecycle

A conversation is many short turns on one socket, so the lease belongs to the
**connection**, not the turn (`credit-leases.service.ts`, driven by
`translation-meter.ts`):

```
first admitted start
   │  open: reserve up to 120 s × multiplier, shrunk to what the user has
   ▼
 open ──── frames arrive, headroom < 30 s ──► extend (single-flight)
   │ ◄──── turn ends ──── settle: whole part of (accepted s × multiplier + carry),
   │                      key settle:<sessionId>; the fraction carries to the next turn
   │
   ├── socket closes ───────────────────────► closed  (unspent credit released)
   └── no activity for lease + 60 s grace ──► reaped  (reaper ticks every 30 s)

late extend / settle / close on a closed or reaped lease → not_open;
the meter opens a new lease the next time the connection needs one
```

Every mutation after `open` is a compare-and-set on `status = 'open'` under the user's
lock, and the reaper uses the same lock and the same check. A lease reaped while its
socket sat idle therefore releases its credit exactly once. A settle that needs more
than the lease holds takes the rest from the grants. Anything beyond the whole balance is
recorded as `overshoot_uncovered`. The meter keeps that to at most one lease per
connection: its mirror of the lease is trusted only until one reaper tick before the
lease could expire, and after that a start or the next audio frame asks the ledger
first, which reopens a reaped lease at whatever the balance still allows. The ledger moves whole
credit-seconds, so the fraction a turn leaves over is carried to the connection's next
turn, and the last remainder is settled, rounded, under `settle:<sessionId>:rest` when
the socket closes.

**The two outage rules are different on purpose.** A start that cannot reach the ledger is
refused with `credits_unavailable`, so nothing new begins unmetered. A connection that is
already running and whose extend fails keeps going for at most one more, virtual, lease.
The extend is retried after 1, 2, 4 and 8 s, then every 15 s, and if the ledger is still
down the connection ends with `credits_unavailable`.

**What clients receive.** The codes are `CREDIT_ERROR_CODES` in
`packages/types/src/events/ws-events.ts`.

- A start needs at least 1 credit. Below that, the start is refused with
  `credits_exhausted`.
- At 2 credits or fewer, `credits_low` arrives once. It is a notice; translation keeps
  going.
- When a running connection runs out, `credits_exhausted` arrives without a turn id. The
  client then finishes gracefully, through the same path as a user stop, so the
  conversation is saved.

## Payments

Each rail is a `PaymentProvider` (`apps/api/src/modules/credits/payments/`):

- **Polar**: card payments in USD, for the monthly subscription and the top-ups.
- **SePay**: VietQR bank transfers in VND, for the 30-day pass and the top-ups.

**Rail modes.** Each rail has its own `sandbox|live` switch. `GET /billing/me` reports a
rail as `unavailable` while any of its secrets is missing, so a deployment without
billing still boots. The keys are in
[environment-variables.md → Billing rails](../environment-variables.md#billing-rails).

**The allowlist is checked twice.** A checkout by an account that is not on the list
gets 403 `CHECKOUT_NOT_OPEN`. The list is checked again when a payment is granted, so a
checkout link made outside the API credits no one. Both checks compare addresses through
`normalizeEmail`.

### Webhook rules

- **The signature is checked over the raw bytes.** `/billing/webhooks` gets its own raw
  body parser, and the check is timing-safe with a ±300 s window. A bad signature gets
  403 on Polar and 401 on SePay, and nothing is written.
- **Dedup and grant share one transaction.** `webhook-inbox.ts` inserts the
  `WebhookEvent` row in the same transaction as the grant it leads to. If the grant fails,
  the dedup row rolls back with it, so the provider's retry is processed again instead of
  being acknowledged as a duplicate.
- **Grants are keyed on the provider's object, not on the delivery.** The keys are
  `polar:order:<id>` and `sepay:tx:<id>`. The same order sent again under a new event id
  therefore still grants once (outcome `duplicate_grant`).
- **Polar** is answered 202.
  - The Pro period comes from the order's embedded subscription.
  - A renewal expires only grants that end at or before the new period starts, so an
    out-of-order delivery never expires a newer period.
  - A subscription event older than the stored `providerUpdatedAt` changes nothing.
  - The user comes from `customer.external_id`, which only this server sets (on the
    checkout it creates), so a renewal order without the checkout's metadata still
    grants. When `metadata.userId` is present it must match. The plan comes from the
    order's product, through `POLAR_PRODUCT_IDS`.
  - A paid order that is not granted (ids disagree, account not allowlisted, product
    maps to no plan) becomes a `needs_review` row keyed `polar:order:<id>`, which the
    owner resolves with the CLI.
  - A signed but malformed payload is acknowledged as `unparsed` and logged. A retry
    could not fix it, and Polar disables an endpoint that keeps failing.
  - Refund events are recorded and nothing else; refunds of real money are handled by
    hand.
- **SePay** is answered 200 with exactly `{"success":true}`, which is why
  `/billing/webhooks/*` is exempt from the response envelope (`transform.interceptor.ts`).
  - A transfer is matched to an order by its code: `SEPAY_ORDER_PREFIX` followed by 8
    base32 characters, read from SePay's `code` field or, failing that, from the memo.
  - An order expires after 30 minutes, but a matching transfer that arrives later still
    grants, and the delay is logged.
  - A wrong amount, or a code that matches no order, grants nothing. It becomes a
    `needs_review` row that the owner resolves with the CLI. Resolving a wrong amount
    grants the plan priced at exactly what was paid, or nothing until `--plan` names
    one, never the plan that was ordered. The order itself keeps its ordered plan, so a
    later transfer of the right amount still buys that plan.
  - A correct transfer for an order already in review grants and marks the order
    `paid`. The earlier transfer moves to a review row of its own under its own
    reference, so resolving it cannot grant the ordered plan a second time.

Routes are in `billing.controller.ts`, `payments/billing-checkout.controller.ts` and
`payments/billing-webhooks.controller.ts`.

## Owner CLI

The commands are in `apps/api/src/cli/` and are built to `dist/cli/*.js`. The
production image has no pnpm, so production runs them with `node` inside the API
container.

| Command                                                                                           | What it does                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `credits-grant.js <email> <credits> <reason>`                                                     | A never-expiring `promo` grant, plus an audit entry carrying the reason. `credits` must be a whole number from 1 to `CLI_GRANT_MAX_CREDITS`. Prints the grant id.                                                                                                                                                                                                                                                |
| `credits-void.js <grantId> [--note]`                                                              | Writes off what the grant still holds. Voiding it again changes nothing.                                                                                                                                                                                                                                                                                                                                         |
| `credits-resolve-payment.js [<orderId> grant\|dismiss [--user <email>] [--plan <code>] [--note]]` | With no arguments, lists the `needs_review` payments and the plan `grant` would give each. `grant` writes the order plan's grant (for a wrong SePay amount, the plan that amount buys) under the payment's own reference, so a later webhook retry cannot grant it again. `--plan` grants another catalogue plan instead. The order keeps its ordered plan, and the plan granted is named in the grant's reason. |
| `credits-cost-report.js [--from YYYY-MM-DD] [--to YYYY-MM-DD]`                                    | Per user and Saigon month: credits settled, plus the tokens and list-price USD behind them, joined from `LlmCallRecord` by `sessionId` at read time. Late polish calls are therefore counted. Minutes runs carry no `sessionId` and are not in it. The price table is in the file.                                                                                                                               |

- In development: `pnpm --filter api build` once, then
  `pnpm --filter api credits:grant <email> <credits> <reason>`. The same pattern works for
  `credits:void`, `credits:resolve-payment` and `credits:cost-report`.
- In production:

  ```bash
  docker exec -it chatofy_prod_api node dist/cli/credits-grant.js <email> <credits> <reason> --prod
  ```

**The guard** is in `cli-prod-guard.ts` and runs before anything connects:

- Only a database on localhost, on any port other than 5433, runs without asking. 5433
  is the production Postgres published on the deploy host.
- Any other database needs `--prod`. Inside the production container that includes
  `postgres:5432`.
- A command that writes also needs a terminal, where the operator types back the email or
  id. That is why the production command uses `-it`.
- The read-only list and report commands need `--prod` but no confirmation.

This was checked on 2026-11-09 against an API image built locally, connected to a
throwaway Postgres reached over the Docker network:

- `dist/cli/*.js` is present and pnpm is absent.
- Without `--prod`, the command is refused.
- With `--prod` but without `-it`, it is refused.
- A wrong typed confirmation writes nothing.
- The right one prints the grant id and writes the grant and its entry.
- `credits-cost-report.js --prod` and `credits-resolve-payment.js --prod` run without a
  terminal.

## Go-live checklist

Selling to the public needs every item below. None of them is done.

1. **Swap the Vietnamese STT model to PhoWhisper (BSD-3) before any public sale.**
   Zipformer-30M's NC-ND licence forbids it. PhoWhisper fits the same `SttProvider`, at
   about 1.3 s per utterance instead of about 0.1 s
   ([README → Model licences](../../README.md#model-licences)).
2. **Polar individual KYC and payout approval.** Polar's review can take up to about 14
   days. After approval, set `POLAR_MODE=live` with the live token, webhook secret and
   product ids, all from the live organization.
3. **Decide on VN tax and e-invoicing** for an individual collecting payments. This has
   not been researched.
4. **Write a refund policy.** Today, refunds of real money are handled by hand. A Polar
   refund event is only recorded, and no credit is clawed back.
5. **Re-verify the webhooks on live.**
   - Both endpoints, with the live secrets.
   - SePay's payment-code structure, set again in Live mode.
   - One real low-value payment on each rail.
   - Cloudflare Bot Fight Mode must not block `/billing/webhooks/*`.
6. **Remove the allowlist.** An unset `BILLING_CHECKOUT_ALLOWLIST` means no one may buy,
   so opening checkout to everyone is a code change, not an env change.
7. **Re-tune the multipliers and plan sizes** from `credits:cost-report` once production
   traffic exists.

## Owner setup: Polar sandbox and SePay

**Polar sandbox** (sandbox.polar.sh, a new organization):

1. Create the products:
   - "Chatofy Pro", monthly recurring, $9.99;
   - one-time products "250 credits" ($5), "550 credits" ($10) and "1500 credits" ($25).

   The prices must match the `Plan` rows.

2. Create an organization access token with the scopes `checkouts:write` and
   `customer_sessions:write`.
3. Add a webhook endpoint:
   - URL `https://<api>/billing/webhooks/polar`, format Raw;
   - let Polar generate the secret;
   - events `order.paid`, `subscription.active`, `subscription.updated`,
     `subscription.canceled`, `subscription.revoked`, `refund.created` and
     `refund.updated`.
4. In prod.env, set:
   - `POLAR_MODE=sandbox`, `POLAR_ACCESS_TOKEN` and `POLAR_WEBHOOK_SECRET`;
   - `POLAR_PRODUCT_IDS=pro_monthly=<id>,topup_250=<id>,topup_550=<id>,topup_1500=<id>`;
   - `BILLING_CHECKOUT_ALLOWLIST=<owner email>`.

**SePay** (my.sepay.vn):

1. Switch the dashboard to Test mode and add a test bank account.
2. Under Payment code structure, set the prefix `CHF` with an 8-character alphanumeric
   suffix.
3. Under Integrations → Webhooks, add:
   - URL `https://<api>/billing/webhooks/sepay`;
   - event Money in, JSON, with auto retry on;
   - auth HMAC-SHA256 (the secret is shown once, so copy it then);
   - optionally, "skip transactions without code".
4. In prod.env, set:
   - `SEPAY_MODE=sandbox`, `SEPAY_WEBHOOK_SECRET`, `SEPAY_BANK_ACCOUNT` and
     `SEPAY_BANK`;
   - `SEPAY_ORDER_PREFIX`, only if the prefix is not `CHF`.
5. For the live top-up, repeat steps 2 and 3 in Live mode for the owner's real account.
   Then set `SEPAY_MODE=live` with the real account and bank.

A changed prod.env takes effect on the next deploy or API restart. What a deploy needs
is in [deployment-guide.md → Deploying credits and billing](../deployment-guide.md#deploying-credits-and-billing).

## Demo runbook

Use the owner's allowlisted account on production. Open Settings › Billing
(`/translate/one-way?settings=billing`) in a second tab to watch the balance.

1. **Polar sandbox subscription.** In Billing, press **Upgrade by card** in the Pro column
   and pay with a Stripe test card (table below). Polar returns to `/settings/billing?checkout=done` (the API's
   `success_url`), which redirects to `/translate/one-way?checkout=done&settings=billing`
   (`apps/web/src/components/settings/legacy-settings-redirects.ts`), so Billing opens with
   the return toast. The Pro column is marked "Your plan" with its renewal date, the sidebar
   badge reads Pro, and the balance gains 600; a top-up bought under **Buy credits** with
   Card selected gains its 250, 550 or 1500 the same way.
   The grant lands when `order.paid` arrives, usually within seconds of the redirect.

   Polar's sandbox charges through Stripe's test mode, so only Stripe test cards work
   there and a real card is declined. Any future expiry (e.g. `12/34`), any 3-digit CVC,
   and any name, email and address:

   | Card                  | Result                                 |
   | --------------------- | -------------------------------------- |
   | `4242 4242 4242 4242` | Paid: the one to use for a grant       |
   | `4000 0025 0000 3155` | Paid after a 3-D Secure challenge      |
   | `4000 0000 0000 0002` | Declined: no order, nothing is granted |

   Polar appends a short-lived `customer_session_token` to the success URL. The web app
   drops it from the address bar and history as it loads; the portal button mints its
   own session.

2. **SePay test QR.** Under **Buy credits**, pick VietQR and press Buy on the 250-credit
   tile. The QR panel shows the amount and the
   transfer note. Simulate a transfer carrying that note from SePay's Test-mode dashboard.
   Within one poll the panel says "Payment received", and a +250 "Credits added" usage
   row appears.
3. **Live owner top-up.** With `SEPAY_MODE=live`, buy the 250-credit pack and pay the
   125,000đ QR from the owner's own bank app. The balance rises within one webhook
   delivery.
4. **Watch the balance drop.** Hold a conversation on `/translate`. Each turn settles when
   it ends: reload with Billing open and the balance is lower, with a "Translation" usage row
   linked to the conversation. With 2 credits or fewer left, the translate page shows the low-credit
   notice. At 0, the conversation stops and is still saved in `/history`.
5. **Cost report.**

   ```bash
   docker exec chatofy_prod_api node dist/cli/credits-cost-report.js --from <YYYY-MM-DD> --prod
   ```

   It shows credits spent against tokens and USD for the demo's user and month.

## Not yet verified (2026-11-09)

- **The runs that need real credentials have not happened.** That means a real Polar
  sandbox run, a SePay Test-mode run and the live SePay top-up. Locally, the webhook rules
  are proven with signed fixtures on the real routes
  (`apps/api/test/billing-webhooks.db-e2e-spec.ts`).
- **No real Polar renewal yet.** The Polar sandbox has no test clock, so a renewal is
  evidenced by waiting a cycle or by posting a payload signed with the real sandbox
  secret.
- **Talking until `credits_exhausted` with the speech sidecars up** has not been done on
  web, mobile or the extension popup. The protocol is proven on the real gateway in
  `apps/api/test/credits-translate-ws.db-e2e-spec.ts`.
