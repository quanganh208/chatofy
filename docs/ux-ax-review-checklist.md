# UX / AX review checklist

What a change to a public page is checked against, for people (UX) and for search
engines and AI agents (AX). The design authority is
[design-guidelines.md](./design-guidelines.md); this file is the review pass, not
the rules. First run and its evidence:
`plans/reports/enhance-ux-ax-261013-1001-chatofy-web.md`.

## Every UI change

- Screenshots at **1440×900, 768×1024 and 375×812** accompany the change. Check for
  overflow, clipped text, overlap and broken images, plus a 320px reflow check.
- The accent and elevation budgets hold (`accent-budget.spec.tsx`,
  `accent-budget-app.spec.tsx`). Layout is not gated by any spec — happy-dom has no box
  model — so the screenshots are the check.
- Reduced motion: the lotus is the only entrance, and it pairs with
  `motion-reduce:animate-none`.
- Landing copy passes `landing-copy.spec.ts` (copy register) in both locales.

## Rubric (score 0–3 with evidence)

First impression · brand recall · content punch · clarity and hierarchy · storytelling
· knowledge and trust · motion · responsive · accessibility (WCAG 2.2 AA) · performance
feel (p75 LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1, measured on a production build rather
than a dev server).

## Discovery surfaces (AX)

All of these are served by `apps/web` and built from the same dictionary and origin
as the page:

| Surface                               | Source                                                 | Kept honest by                                                                                   |
| ------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `/robots.txt`                         | `app/robots.ts`                                        | Its disallow list mirrors the gated routes in `proxy.ts`. Update both together                   |
| `/sitemap.xml`                        | `app/sitemap.ts`                                       | Lists indexable pages only, with no `lastmod` until one is recorded truthfully                   |
| canonical, Open Graph, `twitter:card` | `app/(marketing)/page.tsx`                             | `page-metadata.spec.ts`: a page `openGraph` object drops the file-based image unless it names it |
| JSON-LD                               | `components/marketing/structured-data.tsx`             | Values come from the dictionary; no offers, ratings or FAQ markup                                |
| `noindex` on token pages              | `reset-password` and `verify-email` `generateMetadata` | Never add them to `robots.txt`: a disallowed page's `noindex` is never read                      |
| `/index.md`                           | `app/index.md/route.ts`                                | `landing-markdown.spec.ts` fails when a landing string is missing from the twin                  |
| `/llms.txt`                           | `app/llms.txt/route.ts`                                | Links the absolute `.md` twin                                                                    |
| `/opengraph-image.png`                | `app/(dev)/social-card/page.tsx` (development only)    | Not a test: re-render it with the command in that file whenever `web.landing.heroTitle` changes  |

`robots.ts` and `sitemap.ts` are `force-dynamic`: they read no request, so Next
would otherwise prerender them at build time, before `WEB_BASE_URL` is set. Only a
deployed build shows this; `next dev` hides it.

Run the scan against a running server. A dev server or preview needs the production
origin:

```bash
node .claude/skills/ak-enhance-ux-ax/scripts/check-discovery-surfaces.mjs \
  http://localhost:3001 --site-origin https://chatofy.quanganh208.dev
```

Expected: exit 0. The one accepted warning is `llms-full.txt`, because the site has
no long-form content beyond `/index.md`.

The AI-crawler policy is allow-all, which is what the site did before `robots.txt`
existed. Blocking any crawler is an owner decision.

## Signed-in pages

`/translate`, `/history`, `/history/[id]`, `/preferences` and `/account` are behind
sign-in, so the discovery surfaces don't apply. Review them for UX only. First run and
its evidence: `plans/reports/enhance-ux-ax-261013-1018-auth-pages.md`.

- **Use a local test account, never a real one.** Register it through
  `POST /auth/register`; with SMTP unset, the verification link is printed to the
  api console. Sign in through the real `/login` form.
- **Capture in one browser context.** Refresh tokens rotate, and replaying a saved
  session in a second context revokes the whole family halfway through a run, which
  looks like a random redirect to `/login`.
- **Check every page:** one `<h1>` (nested routes take their parent nav item's title
  through `navItemFor`), no horizontal overflow at 320px, and only expected console
  errors. The expected ones are a 404 for minutes not generated yet, and a 500 for the
  voice list when the TTS sidecar is off.
- **Auth forms read their fields from `FormData`, not from React state.** A value typed
  or autofilled before hydration exists only in the DOM. With controlled fields, the
  submit sent it empty and the reader was told their password did not match. The
  `login-form.spec.tsx` "no input event" case guards this. Forms post rather than get,
  so a submit before hydration cannot put a password in a URL.
- **Seed long turns before judging the transcript.** Two-line fixtures hide width
  problems: on phones the history transcript once read two or three words a line, and
  only real-length turns showed it. Measure the text column (≥ 260px at 375px).
- **Reviewing production is read-only.** Route every non-GET except `/api/auth/*` to
  an abort, and keep screenshots of real conversations out of the repository.
- **Delete the test account and its data afterwards.**
