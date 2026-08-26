# Brainstorm — web IA restructure + UI revamp

Date 2026-08-25 · branch `feat/translate-page-ui-revamp` · skill `/ak:brainstorm --advice`

## Contract

**Outcome.** `apps/web` reads as one product with three distinct chromes instead of
one thin header repeated everywhere: a public marketing landing at `/`, a
signed-in hub at `/dashboard`, and the translator at `/translate` — the last two
under a left sidebar + thin topbar shell. Visual quality raised across all of it
without breaking the token contract the extension, overlay and mobile share.

**Constraints.**

- Design system is test-enforced. `packages/ui/src/react/skin-guard.spec.ts`
  (FORBIDDEN: `dark:`, `bg-accent`, `text-accent-foreground`, `bg-popover`,
  `border-input`, `text-sm`/`text-xs`, `@/lib/utils` alias),
  `apps/web/src/design/app-skin-guard.spec.ts` (bans every size-name utility in
  app code), `token-parity.spec.ts` (hand-written table, asserted in BOTH
  directions against `apps/web/app/globals.css` AND
  `apps/extension/entrypoints/popup/theme.css`), `contrast-floors.spec.ts`.
- Every component web renders is shadcn or composed only from shadcn. CLI-generated,
  then re-skinned per `docs/design-guidelines.md` § Re-skinning a generated component.
- One accent-filled control per screen. Surfaces separated by depth, not rules.
- Motion never in the way of reading a translation; every `transition-*`/`animate-*`
  carries a `motion-reduce:` escape.
- `apps/api` has exactly one Prisma model (`User`). No conversation/session/usage
  data exists. Project rule forbids fake data.
- Tokens are shared with the extension popup, the meeting overlay (permanently dark,
  `overlay-invariants.spec.ts` bans `var(` in its sheet) and React Native mobile.

**Non-goals.**

- Not touching `/translate/live` or `/translate/baseline` behaviour — unlinked
  experiment and measurement baseline stay reachable by URL, unchanged.
- Not building conversation history in this delivery (see Deferred).
- Not changing any palette hex. No new `color` palette entries.
- Not touching the overlay, the popup's own layout, or mobile.
- Not sweeping the 32 remaining Tailwind size utilities in web (its own change,
  already recorded as half-closed in the guidelines).

**Acceptance criteria.**

1. `/` renders a full marketing landing, publicly reachable (proxy matcher already
   exempts the root), with its own header — logo, nav, theme toggle, sign-in +
   primary CTA — and a mobile sheet.
2. `/dashboard` exists, requires a session, and shows only real state: current
   translate settings, account identity from the session, where else Chatofy runs,
   and a real entry into a conversation. No placeholder metrics.
3. `/translate` renders inside the app shell with the sidebar collapsed to an icon
   rail, and the translation stays the largest thing on the surface.
4. Auth routes render under an auth-only chrome — no app nav, no sign-out control.
5. Post-login default destination is `/dashboard` (`DEFAULT_NEXT`), and an explicit
   `?next=` still wins.
6. `pnpm -w test`, `typecheck`, `lint`, `build` green — specifically
   `skin-guard`, `app-skin-guard`, `token-parity`, `contrast-floors`.
7. `docs/design-guidelines.md` § State inventory gains the new surfaces;
   § Copy register gains any new user-facing string.

## Evidence

| Fact                                                                                                                                                   | Source                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Routes today: `/`, `/translate`, `/translate/live`, `/translate/baseline`, 5 auth routes                                                               | `apps/web/app/**`                                           |
| One `AppShell` for every route; header = brand dot + name + optional back link + email + Sign out + theme toggle; body `max-w-2xl`/`max-w-xl` centered | `src/components/layout/app-shell.tsx`                       |
| Only `/` and the auth routes are public; everything else redirects to `/login?next=…`                                                                  | `apps/web/proxy.ts` matcher                                 |
| Post-login fallback destination                                                                                                                        | `src/lib/same-origin-path.ts` `DEFAULT_NEXT = '/translate'` |
| Prisma has one model, `User`; API = auth + `POST /translate` + `GET /translate/voices` + health/meta                                                   | `apps/api/prisma/schema.prisma`, `*.controller.ts`          |
| Type scale tops out at 28px (`--text-title`)                                                                                                           | guidelines § Type, `TYPE_MAPPING` in `token-parity.spec.ts` |
| Parity table asserts both directions against web **and** the extension popup stylesheet                                                                | `token-parity.spec.ts` `SURFACES`                           |
| PDR still records "Full web app (only landing placeholder now)" as out of MVP, and "translation history" as in MVP but unbuilt                         | `docs/project-overview-pdr.md`                              |

## Decisions taken by the user

| Question                        | Answer                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| What the middle tier holds      | Post-login hub, no new backend                                                                               |
| Navigation shape                | Left sidebar + thin topbar                                                                                   |
| Landing depth                   | Full marketing landing                                                                                       |
| Scope ceiling                   | Web + backend if genuinely needed                                                                            |
| Sidebar, after counsel objected | **Keep it**, and split Preferences + Account into their own routes so nav is 4 items with a slot for History |
| Before writing code             | **Static HTML mockup first**, in the plan dir                                                                |
| Language                        | **Bilingual VI/EN with a switcher**                                                                          |

### The one place counsel was overruled

`kongming` recommended dropping the sidebar for contextual header variants, on the
grounds that the app has two real destinations and a sidebar pays off at five. The
user kept the sidebar and accepted the change that answers the objection: Preferences
and Account stop being cards on the hub and become routes. That makes the nav four
items today and five at milestone 6, which is the density a sidebar is for.

Counsel also proposed a `chrome` prop on a single `AppShell` rather than route-group
layouts. Not taken: with a sidebar the app group's DOM structure genuinely differs
from marketing and auth, and one component with three structures is worse than three
layouts. What `AppShell`'s docblock was actually protecting — one owner for the
measure values — is preserved by keeping those in a shared module.

## Mockup

`plans/260825-1531-web-ia-ui-revamp/mockup.html` — self-contained, opens from disk.
Five screens, light + dark, VI + EN, annotations on/off, deep-linkable
(`#screen=dash&theme=light&lang=en&anno=on`).

Verified rather than asserted: a script compared every value in the mockup against
`packages/ui/src/tokens.ts` — **42/42 palette entries** (21 dark, 21 light) and
**6/6 type steps** match exactly. `--text-display` is the only value in the file
that is not already a token. Rendered headlessly in Chrome across six states; three
layout defects found that way and fixed (segmented controls stretching inside a grid
field, emoji glyphs not rendering, and the rail hiding its own icons because the
collapse rule matched every `span`).

## Mockup corrections the user caught

Two things in the first pass were drawn from imagination rather than from the code,
and both are now fixed against the real components.

**`DirectionToggle` is not a segmented control and carries no text arrow.**
`packages/ui/src/react/direction-toggle.tsx` renders two readout boxes — `SOURCE` and
`TRANSLATION`, each a `div` with an uppercase role label over the language name — with
a round 34px `Button variant="outline"` between them carrying lucide's
`ArrowLeftRight`. The readouts use `border-hairline`, not `border-control`, and the
docblock records why: a div with no handler, no tab stop and no role is not a UI
component, so WCAG 1.4.11's 3:1 boundary floor does not reach it, and using the control
token made the two darkest edges on the page belong to the one thing that cannot be
operated. The mockup now mirrors that exactly, including `variant="outline"` resolving
to `bg-secondary` (= `surfaceRaised`) rather than `surface` — drawn on `surface` the
swap button vanished on the dark ground.

**Translate settings become a popover.** Today `CascadePanel` renders
`TranslateSettingsPanel` inline, permanently beside the transcript it competes with.
It moves behind a gear in the app topbar. Adds `popover` to the CLI list. Contents are
unchanged from the real panel: direction, the `Speak translation` switch, voice, speed,
a `Separator`, volume with its tabular-nums percentage, and the transcript layout
control — with direction and voice disabled while a conversation runs, because both
ride `client.session.start` and cannot be reconfigured mid-run.

### The duplication that correction exposed

With settings in a popover on `/translate` AND a `/preferences` route AND the full
control set on the hub, the same controls would exist in three places. There is only
one settings object (`chatofy.translate-settings`), so "defaults vs live" is not a real
distinction here. Resolved:

- **`/translate` popover** and **`/preferences`** render the _same_
  `TranslateSettingsPanel` component, in two mounts. One component, two placements —
  DRY at the level that matters.
- **The hub keeps only `DirectionToggle` + the start button.** Direction is the one
  thing worth deciding before entering a conversation; voice, speed and volume are
  adjusted in context or in Preferences. This is a change from the first mockup and is
  open to reversal if the user wants the fuller launcher back.

### Volume — asked, answered, then changed

It was never stepped in tens. The slider was `min={0} max={1} step={0.05}` — 5%
increments — while `translate-settings.ts` stores a plain float and applies only
`clamp(value, 0, 1)` on read, with no snapping at all. Default is `1`. Contrast
`speed`, which _does_ snap (`z.number().transform(snapSpeed)`) to the
`1 / 1.25 / 1.5` presets, so a stored `0.37` volume survives a reload unchanged while
a stored `1.3` speed does not.

**Changed on the user's instruction to 1% steps** —
`apps/web/src/components/translate/translate-settings-panel.tsx`, `step={0.01}`. This
is the one code edit made during the brainstorm. It also removes a small incoherence:
the readout is `Math.round(volume * 100)%`, so at 0.05 the number moved in fives and
most of the percentages it could display were unreachable by dragging. Only that one
line referenced the step; the `step` in `use-translate-settings.spec.tsx:82` is a loop
variable for the debounce test and is unaffected. Verified: `pnpm --filter web test`
374/374 green, `typecheck` clean.

## Added to scope by the user: bilingual VI/EN

Chose it after being told it is a separate delivery.

**Mechanism: locale in a cookie, no URL segment**, with a `?lang=vi|en` override so a
demo link opens in a fixed language. The prefix option was priced against this repo
rather than in the abstract: 10 files move under `app/[locale]/`, 8 literal `href`s
and 6 `redirect`/`router.push` sites need a locale-aware wrapper, `sameOriginPath`'s
single blessed `Route` assertion becomes locale-aware, and `proxy.ts`'s matcher gets
rewritten — the regex whose own comment records the near-miss where a live token
would have landed in `?next=` and in browser history. Nest-minted email links would
stay unprefixed forever and need a detect-and-redirect hop. Cookie touches three
places instead: the root layout (whose `<html lang="en">` is hard-coded today and has
to change under either option), one provider, one switcher doing `router.refresh()`.

Accepted knowingly, and to be written into the plan so nobody "fixes" them later:

- No hreflang, one URL serving two contents, no separately indexed VI/EN pages. Near
  worthless for a thesis-demo landing; the migration to `localePrefix: 'as-needed'`
  stays open as long as strings are centrally keyed, which they will be.
- Reading `cookies()` in the root layout opts every route into dynamic rendering. The
  landing stops being statically prerendered. A non-cost for self-hosted SSR here.

**No library.** `next-intl`'s value is its routing middleware and navigation wrappers,
and the cookie decision deletes both from the requirements. What is left — `t()`,
interpolation, typed keys — is ~60–80 lines. `MessageKey = keyof typeof en` makes
TypeScript enforce key parity between locales, which is the same parity-by-
construction the repo already trusts in `token-parity`, except `tsc` is the spec and
no test needs writing. Vietnamese has no grammatical plural, so ICU machinery would
buy only the English half of a handful of strings.

**Strings live in a new `packages/i18n`** — plain TS, zero dependencies, no React, the
same constraints and the same justification as `tokens.ts` (Metro must be able to
import it; the popup must be able to). Namespaced by surface so the popup and mobile
adopt later by importing and adding a namespace, not by a second extraction. The
React provider stays in `apps/web`, its only consumer today.

**Default locale: negotiated from `Accept-Language`**, then the explicit switcher
choice persists.

### Scope of the bilingual work

**In:** landing, hub, translate (+ the two experiment routes, which are reachable),
all 5 auth pages, the shared chrome, and client-authored error prose —
`src/components/auth/auth-error-message.ts` already maps API error codes to prose,
which is exactly the seam to extend.

**Also in, by the user's decision: the auth emails.** They are Nest-minted, so this is
the one part of the delivery that touches `apps/api` and the schema. Sized: all four
templates live in ONE place — `MAIL_CONTENT` in
`apps/api/src/modules/mail/interfaces/mail-sender.interface.ts`, already a
`Record<MailPurpose, (link) => { subject, text }>` over four purposes
(`verify-email`, `account-exists-notice`, `no-account-notice`, `password-reset`). The
work is a `locale` column on `User` + migration, a locale carried on registration
(no row exists yet at that moment), and a locale argument threaded into
`MAIL_CONTENT`. `no-account-notice` has no user row by construction and must fall back
to the requesting locale.

**Out, recorded:** the extension popup, the meeting overlay, and mobile.

### Two things the extraction will hit

- `packages/ui/src/react/theme-toggle.tsx` carries four hard-coded English strings
  (`'Light'`, `'Dark'`, `'Match system'`, `aria-label="Colour theme"`) and is rendered
  by the popup as well as web. Fixed the shared package's own way — compositions are
  controlled, so it takes optional label props defaulting to today's English, and web
  passes localized labels down. The popup is unaffected.
- **Seven** spec files assert literal English copy: `auth-error-message.spec.ts` (6
  assertions), `verify-email-client`, `reset-password-form`, `register-form`,
  `forgot-password-form`, `login-page`, `login-form`. They should import the EN
  dictionary rather than restate it, or every copy edit becomes a two-place edit.

### The anti-pattern to name in the plan

`layout.tsx`'s pre-paint localStorage script is this repo's most carefully documented
client-state pattern, and it is the wrong template for locale. Theme is one class
attribute — suppressible, paint-safe. Locale is the text content of the whole tree: a
client-side switch means the server renders EN and hydration renders VI, which is a
full-page mismatch and a visible language flash on every load, and no
`suppressHydrationWarning` scope covers it. Locale must be server-known from the
cookie, and the switcher must go through `router.refresh()`.

## Chosen direction

**Next.js route groups, not new URL segments.** `app/(marketing)/`, `app/(auth)/`,
`app/(app)/`. Route groups do not appear in the URL, so every existing route keeps
its address while each group gets its own `layout.tsx` — which is exactly the
mechanism for three different chromes. `AppShell` is decomposed into those three
layouts and deleted.

```
app/
  (marketing)/layout.tsx      marketing header + footer
  (marketing)/page.tsx        /            landing
  (auth)/layout.tsx           centered, no nav
  (auth)/login|register|forgot-password|reset-password|verify-email
  (app)/layout.tsx            sidebar + topbar
  (app)/dashboard/page.tsx    /dashboard   hub
  (app)/translate/page.tsx    /translate   translator (sidebar collapsed)
  translate/live|baseline     unchanged, outside the group, unlinked
```

Only `DEFAULT_NEXT` changes address (`/translate` → `/dashboard`). The proxy matcher
needs no edit: `/dashboard` is not on the exemption list, so it is protected by
construction.

**Why not `/app/translate`.** It buys nothing route groups do not, and it moves a URL
that `?next=` values, docs and the guidelines all reference.

### What the hub holds — all of it real

1. **Start a conversation** — the one accent-filled control on the surface. Direction,
   voice and speed picked here, written through the existing
   `chatofy.translate-settings` key, carried into `/translate`.
2. **Preferences** — voice, speed, volume, transcript layout, editable inline. Real
   values from `useTranslateSettings`.
3. **Account** — email and verified state from the session / `GET /auth/me`.
4. **Where else Chatofy runs** — extension and mobile, with what each is for.
5. **Readiness** — microphone permission state and API reachability (`GET /health`).

No metric tiles, no "0 conversations" card, no recent-activity placeholder. A card
for a feature that does not exist is the fake data the rules forbid.

### The chrome

- **Marketing** — sticky header, transparent over the hero, logo + wordmark, anchor
  nav, theme toggle, ghost "Sign in" + one accent CTA. Sheet on mobile.
- **Auth** — logo, centered card, link home. No nav, no sign-out.
- **App** — collapsible left sidebar (Dashboard, Translate, Preferences, Account) that
  drops to an icon rail at `md` and to a sheet on mobile; thin topbar carrying the page
  title, the live status pill, theme toggle and an avatar dropdown that replaces today's
  bare email + Sign out button. On `/translate` the sidebar defaults to the rail.

## Cost against the design system

| Item                                                                                                 | Cost                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marketing hero needs display type; scale stops at 28                                                 | Add one `fontSize` step + `--text-display` to `tokens.ts`, `globals.css`, the popup's `theme.css`, and `TYPE_MAPPING`. Mechanical, 4 files. The only genuine token extension.                                                                                                                                                    |
| shadcn `sidebar` block ships 8 `--sidebar-*` tokens and pulls Sheet, Tooltip, Skeleton, `use-mobile` | Map every `--sidebar-*` to an **existing** palette key (alias only, no new hex), and make `token-parity.spec.ts`'s mapping per-surface so the popup is not forced to declare tokens it never renders.                                                                                                                            |
| New primitives required from the CLI                                                                 | `sheet`, `tooltip`, `dropdown-menu`, `avatar`, `skeleton`, `sidebar`, `accordion`, **`popover`** (the translate settings surface). Each needs the documented re-skin pass — the CLI writes `bg-popover`, `text-sm`, `bg-accent`, `border-input` and `dark:`, all of which the skin guard fails on. This is the bulk of the work. |
| Landing motion                                                                                       | Allowed off the translate surface, but every animated utility carries `motion-reduce:`.                                                                                                                                                                                                                                          |
| Docs                                                                                                 | § State inventory gains landing / dashboard / sidebar states; § Copy register gains the marketing strings; PDR's "web is a landing placeholder, out of MVP" is now false; `codebase-summary.md` route list changes.                                                                                                              |

## Phases

| #   | Phase                                                                                            | Gate                                                          |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 0   | Per-surface parity mapping + `--text-display`                                                    | `token-parity` green                                          |
| 1   | CLI-generate and re-skin the 7 new primitives, export from `@chatofy/ui/react`                   | `skin-guard`, `contrast-floors` green                         |
| 2   | Route groups + three layouts; delete `AppShell`                                                  | every existing route renders, all app tests green             |
| 3   | `/dashboard` + `DEFAULT_NEXT`                                                                    | signed-in flow lands on the hub, `?next=` still wins          |
| 4   | `/` marketing landing                                                                            | public, responsive, both themes                               |
| 5   | `/translate` focus mode inside the app shell                                                     | translation still the largest element                         |
| 6   | Auth chrome                                                                                      | `app-skin-guard` green                                        |
| 7   | `packages/i18n` + extraction across web; `theme-toggle` label props; specs import the dictionary | `tsc` proves key parity; all 7 copy-asserting specs green     |
| 8   | `User.locale` + migration + locale threaded into `MAIL_CONTENT`                                  | api tests green; all 4 templates render in both locales       |
| 9   | Docs sweep                                                                                       | State inventory, Copy register, PDR, codebase-summary updated |

## Deferred, with a reason

**Conversation history.** The PDR puts it in MVP; nothing implements it, and the
tables were dropped in the migration squash. It is the only thing that would turn
the hub into a real dashboard, and it is a backend delivery — Prisma models,
migration, persistence on the translate path, list/detail endpoints — not a UI one.
Kept out so the UI revamp does not become a schema change, and named here so the
next person finds a decision rather than a gap.

## Unresolved questions

1. Sidebar nav label for `/dashboard` — "Dashboard" or "Home"? The copy register
   prefers naming the outcome; neither is wrong.
2. Landing language — English only, Vietnamese only, or both? Everything user-facing
   is English today, but the audience is Vietnamese professionals.
3. Does the landing need a live demo or recorded clip in the hero? That is an asset
   question, not a code one, and it changes the hero's structure.
