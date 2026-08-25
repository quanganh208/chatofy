---
title: 'Phase 10: Vietnamese locale and switcher'
status: todo
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

- [ ] `vi` covers every key; a missing one is a compile error
- [ ] Locale resolves server-side from a cookie, negotiated from `Accept-Language` on first visit
- [ ] A switcher in the app and marketing chrome
- [ ] A shareable link can pin a language
- [ ] Metadata is localized
- [ ] No hydration mismatch, no language flash

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

- [ ] Deliberate break: add a key to `en` only → `tsc` fails naming it
- [ ] All 12 routes verified in both locales against a written checklist — not "the switcher flips every surface", which passes while a string is missed
- [ ] A prod build shows no hydration warning and no intermediate-language frame
- [ ] `Accept-Language: vi` on a fresh browser renders Vietnamese; `en` renders English
- [ ] `/locale?lang=en&next=/dashboard` sets the cookie and lands on `/dashboard`
- [ ] `/locale?lang=en&next=https://evil.example` does **not** redirect off-origin
- [ ] `/locale?lang=xx` falls back without throwing
- [ ] Browser tab titles are localized
- [ ] The list of un-dictionaried server strings is written down, and each is a code-less passthrough
- [ ] No horizontal overflow in Vietnamese at 320px
- [ ] `pnpm --filter web test` green with the seven specs rewritten

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
