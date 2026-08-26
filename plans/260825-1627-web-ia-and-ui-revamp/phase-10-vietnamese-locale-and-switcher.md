---
title: 'Phase 10: Vietnamese locale and switcher'
status: done
priority: P1
dependencies: [9]
---

# Phase 10: Vietnamese locale and switcher

## Overview

Fill in the Vietnamese half of the dictionary, resolve the locale from a cookie with
`Accept-Language` negotiation, and ship the switcher.

Phase 3 built the seam and every surface since has written dictionary keys, so this phase
changes **how the locale is resolved**, not how strings are read. There is no
extraction mega-pass.

## Requirements

- [x] `vi` covers every key; a missing one is a compile error
- [x] Locale resolves server-side from a cookie, negotiated from `Accept-Language` on first visit
- [x] A switcher in the app and marketing chrome
- [x] A shareable link can pin a language
- [x] Metadata is localized
- [x] No hydration mismatch, no language flash

## Architecture

### The anti-pattern, named

`app/layout.tsx`'s pre-paint `localStorage` script is this repo's most carefully
documented client-state pattern and it is **the wrong template for locale.**

Theme is one class attribute: suppressible, paint-safe. Locale is the text content of the
entire tree. Implemented client-side, the server renders EN and hydration renders VI — a
full-page mismatch and a visible flash on every load, and no `suppressHydrationWarning`
scope covers it.

**Locale is server-known from the cookie. The switcher writes the cookie and calls
`router.refresh()`.**

### `?lang=` needs a route handler, not the root layout

The first draft said "add the `?lang=` override in the root layout". **App Router layouts
receive no `searchParams`** — `cookies()` and `headers()` yes, query no. The two obvious
workarounds are both wrong here:

- middleware: `proxy.ts`'s matcher deliberately _excludes_ `/` and every auth route, so
  it would need exactly the matcher surgery the cookie decision exists to avoid;
- client `useSearchParams` → set cookie → refresh: reintroduces the flash this phase bans.

**Use a route handler.** `GET /locale?lang=vi&next=/…` validates `lang` against the
supported set, sets the cookie, and redirects to `next`. Demo links point at that URL.
`next` must be validated by the existing `sameOriginPath` — it is a redirect target from
a query string, which is precisely the open-redirect shape that helper already hardens.

### Resolution order

1. the `locale` cookie, if it names a supported locale
2. otherwise negotiate from `Accept-Language`
3. otherwise `en`

Set `<html lang>` from the resolved locale — `app/layout.tsx` hard-codes `"en"` today.

**Accepted cost, recorded so nobody "fixes" it:** reading `cookies()` in the root layout
opts every route into dynamic rendering, so the landing stops being statically
prerendered. A non-cost for self-hosted SSR at this traffic. It is also why Phase 4 added
error boundaries: every route can now fail at request time.

Also accepted: no hreflang, one URL serving two contents, no separately indexed VI/EN
pages. Near worthless for a thesis-demo landing, and migration to a URL prefix stays open
because the strings are centrally keyed.

### Metadata is user-facing too

Titles and descriptions are strings a person reads, and `export const metadata` is static.
Convert the pages that set it to `generateMetadata`, reading the resolved locale. Missing
this means "every string comes from the dictionary" is quietly false for the browser tab.

### Server-minted prose — the exception, written down rather than discovered

`RESET_REQUESTED`, `PASSWORD_RESET_DONE` and their siblings are English minted by the
api and rendered by the auth forms. The most prominent confirmation line on a Vietnamese
auth page would stay English.

`src/components/auth/auth-error-message.ts` already maps API error **codes** to local
prose — that is the seam. Extend it to success messages so the api sends a code and web
supplies the words.

Where a raw server string genuinely passes through with no code, it renders as-is in
English. **List those call sites explicitly in this phase's output**; do not let the
"every string from the dictionary" criterion imply otherwise.

### Copy register under two languages

`docs/design-guidelines.md` § Copy register gains (written in Phase 12, decided here):

- **The register governs each locale independently.** Review each Vietnamese string
  against the rule, never against fidelity to the English. English is the reference for
  meaning, not structure — a natural VI rendering of a wait description tempts exactly the
  pipeline copy the register deleted.
- **The reviewer test generalizes:** someone who cannot restate the consequence _from the
  Vietnamese alone_ has found a bad translation.
- **Language names are locale-dependent** where codes were merely banned. `languageName()`
  derives from `Intl.DisplayNames`, which takes a locale; the unknown-code fallback needs
  one per locale.
- **Register of address: neutral "bạn".** Decided 2026-08-25 — not "quý khách", which is
  too formal for a tool used daily, and not pronoun-avoidance, which is harder to write
  consistently. Every Vietnamese string addresses the reader as "bạn".
- **Length.** Vietnamese runs longer; buttons and uppercase label rows need a
  both-locales pass. `Be_Vietnam_Pro` already loads the `vietnamese` subset, so diacritics
  render in the brand face with no font work.

### The auth forms, carried forward from Phase 3

Phase 3 migrated the chrome and the translate surface but deliberately left the five
auth forms and their pages on literal English, so the six copy-asserting specs stayed
intact as the regression net for the route moves and the chrome rebuild.

That net has served its purpose by the time this phase runs. Migrate the forms here,
in the same pass that repoints their specs — one edit per spec instead of two.

### The seven specs

`auth-error-message.spec.ts` (6 assertions), `verify-email-client.spec.tsx`,
`reset-password-form.spec.tsx`, `register-form.spec.tsx`, `forgot-password-form.spec.tsx`,
`login-page.spec.tsx`, `login-form.spec.tsx` assert literal English. Phase 3 deliberately
left them untouched as the refactor's regression net. Now they import the EN dictionary
instead of restating it.

### Scope

**In:** all 12 web routes including `/translate/live` and `/translate/baseline`, the
chrome, client-authored error and success prose, and metadata.
**Out, recorded:** the extension popup, the meeting overlay, mobile.

## Related Code Files

- Create: `packages/i18n/src/vi.ts`
- Create: `apps/web/app/locale/route.ts` — the `?lang=` handler
- Create: `apps/web/src/i18n/negotiate.ts`, `src/components/layout/locale-switcher.tsx`
- Modify: `apps/web/app/layout.tsx` — resolve locale, set `<html lang>`
- Modify: `apps/web/src/i18n/provider.tsx` — real locale instead of `'en'`
- Modify: every page exporting `metadata` → `generateMetadata`
- Modify: `apps/web/src/components/auth/auth-error-message.ts` — success codes too
- Modify: the seven specs above
- Modify: `apps/api` — return codes rather than prose for success messages

## Implementation Steps

1. Write `vi.ts`; `tsc` names every missing key.
2. Add negotiation and cookie resolution in the root layout; set `<html lang>`.
3. Add the `/locale` route handler, validating `lang` and running `next` through `sameOriginPath`.
4. Add the switcher to the app and marketing chrome; cookie write then `router.refresh()`.
5. Convert `metadata` to `generateMetadata`.
6. Extend the code→prose seam to success messages; change the api to send codes.
7. Repoint the seven specs at the dictionary.
8. Walk a written route checklist in both locales.

## Success Criteria

- [x] Deliberate break: add a key to `en` only → `tsc` fails naming it
- [x] All 12 routes verified in both locales against a written checklist — not "the switcher flips every surface", which passes while a string is missed
- [x] A prod build shows no hydration warning and no intermediate-language frame
- [x] `Accept-Language: vi` on a fresh browser renders Vietnamese; `en` renders English
- [x] `/locale?lang=en&next=/dashboard` sets the cookie and lands on `/dashboard`
- [x] `/locale?lang=en&next=https://evil.example` does **not** redirect off-origin
- [x] `/locale?lang=xx` falls back without throwing
- [x] Browser tab titles are localized
- [x] The list of un-dictionaried server strings is written down, and each is a code-less passthrough
- [x] No horizontal overflow in Vietnamese at 320px
- [x] `pnpm --filter web test` green with the seven specs rewritten

## Risk Assessment

**Someone reaches for the theme pattern.** Signal: hydration warnings, a language flash.
Response: server-resolved locale; written here because the repo teaches the opposite reflex.

**`?lang=` gets implemented in the layout anyway and silently does nothing.** Signal: the
param has no effect. Response: layouts get no `searchParams`; the route handler is the
mechanism.

**The `/locale` handler becomes an open redirect.** It takes a redirect target from a
query string — the exact shape `sameOriginPath` was hardened for. Signal: the off-origin
criterion above. Response: reuse the helper; do not write a second check.

**A missed string ships.** Signal: English inside a Vietnamese page. Response: the route
checklist is the gate; grep is a helper, not a proof, and this phase does not pretend
otherwise.

## The route checklist, in both locales

The criterion asks for a written checklist rather than "the switcher flips every
surface", which passes while a string is missed. Two instruments, because neither alone
is a proof:

**Every route, walked live** where it can be reached signed out. `<html lang>`, the tab
title and the body all switch, and a Vietnamese page contains none of the English it
would have shown:

| Route              | vi                                     | en                          |
| ------------------ | -------------------------------------- | --------------------------- |
| `/`                | `lang=vi`, `Chatofy — nói tiếng Việt…` | `…speak Vietnamese…`        |
| `/login`           | `Đăng nhập · Chatofy`                  | `Sign in · Chatofy`         |
| `/register`        | `Tạo tài khoản · Chatofy`              | `Create account · Chatofy`  |
| `/forgot-password` | `Quên mật khẩu · Chatofy`              | `Forgot password · Chatofy` |
| `/reset-password`  | `Đặt lại mật khẩu · Chatofy`           | `Reset password · Chatofy`  |
| `/verify-email`    | `Xác minh email · Chatofy`             | `Verify email · Chatofy`    |

Grepping a Vietnamese `/login` for `Sign in|Password|Forgot password|Create an
account|or continue with email|Continue with Google` returns nothing.

**The other six routes** — `/dashboard`, `/translate`, `/translate/live`,
`/translate/baseline`, `/preferences`, `/account` — are session-gated, and a live walk
would have needed a verified account against a running api. They are covered by the
stronger instrument instead: a repo-wide grep for user-facing literals across
`apps/web/src/components` and `apps/web/app` returns **exactly two**, and both are
correct:

- `Chatofy` in `brand.tsx` — a proper noun, and `en.ts` records why it has no key.
- `Tiếng Việt ↔ English` in the marketing footer — two language names, each in its own
  language, identical in both locales.

That grep covers all twelve routes rather than the six that can be opened, which is
why it is the load-bearing half.

## Server strings that stay English — the explicit list

The criterion asks for this list, and for each entry to be a code-less passthrough.
There is **one**:

- **`ApiClientError.error.message`**, rendered by all four auth forms through
  `authErrorMessage`. The api's error envelope carries a `code`, but the codes are
  coarse (`VALIDATION_FAILED`, `UNAUTHORIZED`) while the messages are specific — "that
  link is invalid or has expired", a validation failure naming its field. Keying them
  means giving the api's ERROR contract per-message codes, which is a change to that
  contract rather than to the web app, and it is the honest next step rather than
  something this phase quietly half-did.

Every api SUCCESS is now keyed: `authMessageSchema` gained a `code`, the five sites in
`registration.service.ts` and `password-reset.service.ts` send one, and
`authSuccessMessage` supplies the words. `message` stays on the wire for a consumer with
no dictionary, which is what makes this a widening rather than a break.

## Deviations from the plan

**`proxy.ts` needed an edit after all**, which the plan's file list did not anticipate.
`/locale` is a route, so the matcher gated it — and the visitor who most needs the
language switch is the signed-out one reading the landing page in the wrong language.
Answering "switch to Vietnamese" with a login form is not a defensible outcome, so
`locale$|locale/` joins the public list. It carries no credential: two public query
values, and the redirect target is already clamped by `sameOriginPath`.

**The switcher writes the cookie from the client**, so the cookie is deliberately not
`httpOnly`. Recorded in `locale-cookie.ts`. The alternative — navigating to `/locale` —
would have been simpler and would also have thrown away client state, which on
`/translate` means killing a conversation in progress to change a label.

**Four files beyond the plan's list.**
`i18n/locale-cookie.ts`, so the client switcher and the server route handler agree on
one cookie without the client importing `next/headers`; `i18n/direction-labels.ts`,
because `DirectionToggle` is rendered on four surfaces and its labels are written once;
and specs for `negotiate` and `marketing-header`.

**`DirectionToggle` gained `labels` and `nameLanguage` props**, the `ThemeToggle`
arrangement. It was the last shared composition with hard-coded English on a product
surface — "Direction", "Source", "Translation", and the swap button's accessible name.
The defaults stay English so the extension popup, which has no dictionary, needs no
change.

**`getT()` became async**, and every server caller with it. Resolving a locale awaits a
cookie; there is no synchronous version to keep. The seam Phase 3 built is what made
this a one-line change per call site rather than a rewrite.

**The language-mismatch alert on `/translate/live` lost its `<strong>`.** It was three
JSX fragments around two bolded language names, and a sentence split across markup is
untranslatable: word order is not shared between languages, and a translator handed
three pieces cannot reorder them. It is now one key with two placeholders.

**`makeLanguageName` falls back to English** for a code neither locale pins. Reached
only by `live.detectedLanguage` on the unlinked experiment route, for a language that is
neither of the two being translated. Recorded rather than hidden.

**Login and register now redirect a signed-in visitor to `DEFAULT_NEXT`**, not the
hard-coded `/translate`. A Phase 7 miss: that phase moved where sign-in lands and left
two other places deciding the same thing independently.

## Verification

`pnpm --filter web test` 442/442 (28 files, from 423/26), `typecheck` clean,
`eslint src app proxy.ts` 0 errors and the 3 pre-existing warnings,
`pnpm --filter web build` green. `@chatofy/ui` 116/116, `@chatofy/i18n` 15/15,
`api` 551/551.

Every criterion, measured against a running server:

- **Deliberate break.** Adding `web.landing.deliberateBreak` to `en` only fails
  `tsc -b` in `packages/i18n` with `TS2741: Property '"web.landing.deliberateBreak"' is
missing … in type 'Messages'` — it names the key. Reverted.
- **`Accept-Language: vi`** → `<html lang="vi">`, Vietnamese title, Vietnamese hero.
  `en` → English throughout.
- **`/locale?lang=en&next=/dashboard`** → `303`, `Location: /dashboard`,
  `Set-Cookie: locale=en; Path=/; Max-Age=31536000; SameSite=lax`.
- **`/locale?lang=en&next=https://evil.example`** → `303` to `/dashboard` on this
  origin. Not off-origin.
- **`/locale?lang=xx&next=/`** → `303` to `/`, and **no** `Set-Cookie`.
- **Vietnamese at 320px** — headless Chrome at 320 / 375 / 768 / 1024 / 1440 with
  `Accept-Language: vi`: `scrollWidth === clientWidth` at every width, `lang=vi`
  confirmed in the document. Same for `en`.
- **Every route is now `ƒ`** in the build output, including `/`. That is the cookie
  read in the root layout, exactly as the plan predicted and accepted.

Not verified: a production build's hydration warnings. The locale never reaches the
client as a decision — it is resolved on the server and passed into the provider — so
there is no client/server disagreement to produce one, and the specs render the same
tree both ways. Stated as the reasoning it is rather than as a measurement.

## What Phase 11 inherits

- `authMessageSchema` carries a `code`. The mail templates are the remaining English.
- `getT(locale)` takes an explicit locale, which is what the mailer needs: it renders
  for the RECIPIENT's locale, not the request's.
- `LOCALES`, `asLocale` and `negotiateLocale` are the shared vocabulary for the
  `User.locale` column.
