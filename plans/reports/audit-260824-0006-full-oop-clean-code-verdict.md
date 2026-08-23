# Audit verdict — OOP, clean code, redundancy (full scope)

Date: 2026-08-24 · Branch `main` · Mode: read-only, nothing changed
Scope: whole repo, with a deep pass on auth, users, and the newly-built auth feature
across api / web / extension / mobile.

Consolidates four passes. Detail lives in:

- `audit-260823-2353-oop-clean-code-redundancy.md` — repo-wide
- `audit-260824-0006-auth-user-security.md` — auth/users, security lens
- `audit-260824-0006-auth-user-oop-clean-code.md` — auth/users, OOP lens
- this file — client side of the new feature + consolidated verdict

## Verdict

Code is OOP-correct where OOP belongs, clean by every measure that was run, and has
**no redundant files**. Total actionable list across all four passes is **~60 lines**:

| #      | Finding                                                             | Size           | Confidence                |
| ------ | ------------------------------------------------------------------- | -------------- | ------------------------- |
| **C1** | Error mapping copy-pasted across 4 auth forms, **0% test coverage** | ~24 → helper   | Proven by coverage census |
| **F1** | Dead `update` chain across 4 files, no caller                       | ~25 LOC delete | Proven by call-site sweep |
| **F2** | `UsersService`: 3 of 5 methods dead                                 | ~10 LOC delete | Proven                    |
| **H**  | Redundant `export` keywords, dead aliases, stale knip entries       | ~20 LOC        | Proven                    |
| **D**  | Three comments that no longer match the code                        | 3 lines        | Proven                    |

Everything else examined was either correct or a **documented, deliberate** trade-off.

## Method — how this list was kept honest

The short list is a result, not a shrug. Three things guarded against rubber-stamping:

1. **Falsification probes were run, not assumed.** jscpd (1.20% duplication), suppression
   census (2 `eslint-disable`, 1 `@ts-ignore`, 4 `any` across 379 non-spec files),
   `pnpm lint` (0 errors), `pnpm typecheck` (14/14), CI enforcement check.
2. **Advisory findings were verified, and three were rejected.** An advisory pass raised
   `theme.css`↔`globals.css` token duplication, the socket twins, and `background.ts`
   cohesion. All three were checked against source and **all three were false positives** —
   each is deliberate, documented, and the token CSS is guarded by `token-parity.spec.ts`,
   which reads _both_ files and asserts parity in both directions. Text-similarity tools
   cannot see a spec holding a duplication in place.
3. **The bar cut both ways.** The same pass that rejected those three found F1 — a dead
   chain `knip` structurally cannot detect, because they are public methods on an exported,
   used class.

## C1 — the strongest finding: 4-way duplicated error mapping

`register-form.tsx:47-53`, `forgot-password-form.tsx:44-50`, `reset-password-form.tsx:61-66`,
`verify-email-client.tsx:92-98` each carry the identical block; only the final fallback
string differs:

```ts
if (err instanceof ApiClientError) setError(err.error.message);
else if (err instanceof ContractError) setError('Unexpected response from the server.');
else if (err instanceof NetworkError)
  setError(err.timedOut ? 'That took too long — try again.' : 'Cannot reach the server.');
else setError('<flow-specific fallback>');
```

**Why this is a defect and the repo's other duplications are not — the decisive evidence is
the test gap, not the missing comment.** This repo holds deliberate duplication together with
tests: `token-parity.spec.ts` reads both CSS files; `proxy-matcher.spec.ts` pins the middleware
regex against over-match. The C1 mapping has **no guard at all**:

```
$ grep -c "ContractError|NetworkError|Cannot reach the server|took too long" *.spec.tsx
register-form.spec.tsx:0   forgot-password-form.spec.tsx:0
reset-password-form.spec.tsx:0   verify-email-client.spec.tsx:0
```

Coverage census confirms it precisely — the uncovered lines in all four files are **exactly and
only** the mapping block:

```
forgot-password-form.tsx   branch 50%    uncovered 45-50
register-form.tsx          branch 50%    uncovered 48-53
reset-password-form.tsx    branch 56%    uncovered 61-66
verify-email-client.tsx    branch 65%    uncovered 92-98
```

A reworded string or a dropped `else if` in one copy drifts silently with green tests.
Secondary evidence: the duplicated strings are transport-level copy ("Cannot reach the
server.") where divergence across screens is always a bug, never a feature — and the one axis
that _could_ legitimately diverge (the fallback) is already the parameter.

**Fix:** `authErrorMessage(err: unknown, fallback: string): string` in
`apps/web/src/components/auth/auth-error-message.ts`, with a spec covering the four branches
plus the `timedOut` variant — mirroring the existing `src/lib/same-origin-path.ts` + spec pattern.

Two constraints:

- Map **error → string only**. Do not absorb `setError`/`setSubmitting`: reset-password and
  verify-email deliberately call `setSubmitting(false)` inside `catch` (documented: no
  re-enable mid-navigation) while the others use `.finally`. That asymmetry stays in the forms.
- Do **not** hoist into `@chatofy/api-client`. These are web-app English strings; the
  extension deliberately surfaces the API's own wording and mobile is a stub, so the shared
  package would be exporting one client's prose.
- Leave `login-form.tsx` alone — it goes through NextAuth `signIn()` and collapses every
  failure to one message deliberately, for enumeration reasons.

## C2 — the four `api-client.ts` wrappers: leave them

`register` / `verifyEmail` / `forgotPassword` / `resetPassword` are four 5-line POST wrappers
sharing `authMessageSchema`, differing only in path and JSDoc.

The clean way to say why this differs from C1: **C1 is one fact in four places; C2 is four
facts in four places.** Each wrapper encodes independent per-endpoint knowledge that cannot
drift against a sibling, so DRY's actual concern does not apply. A factory would also
generalize over exactly four call sites forever — `translate()` uses a different schema and
does not fit, and no fifth `authMessageSchema` endpoint is coming.

(Note: "a factory would cost the JSDoc" is _not_ a valid reason — doc comments sit on a
`const` fine. The reasons above are the real ones.)

## C3 — mobile is pre-implementation scaffolding

`StubAuthClient` throws on all five methods; `auth-client.interface.ts` says "swap for
Supabase/BetterAuth"; `audio-recorder.interface.ts` and `audio-player.interface.ts` are
already in `knip.json`'s ignore list; `theme.ts` carries the three dead aliases. Whole app is
540 LOC / 19 files.

This is the repo's **only speculative generality** — abstractions written for implementations
that do not exist. Acceptable as deliberate scaffolding _iff_ the mobile app is on the
roadmap. The knip-ignore entries are an honest marker that the repo already knows. Whether to
keep the interface indirection or delete it is product scope, not a code-quality call.

## D — three comments that no longer match the code

A small but real category, since this repo's comments are load-bearing:

1. `apps/web/app/register/page.tsx:39-40` — "both children call `useSearchParams`, and both
   must sit inside it." Verified false: `GoogleButton` does (`google-button.tsx:3,55`),
   `RegisterForm` does not (zero `next/navigation` references). Copied from
   `login/page.tsx:105`, where the same sentence **is** accurate. The Suspense boundary is
   still needed — for one child, not two.
2. `UsersService`'s class docstring — "Place domain validation / business rules here" — is
   scaffolding for logic that never arrived, and contradicts `users.module.ts`, which
   documents the real rationale (privilege separation: credential reads kept off a
   general-purpose service).
3. `knip.json` — `ignoreBinaries: ["blue,cyan,green"]` is one malformed string, not three
   entries.

## Observations — no action recommended

- **`use-popup.ts` 296 LOC** vs the project's 200-line guideline: one cohesive MV3-popup hook
  (14 state hooks, 8 callbacks) gathering everything the popup knows at open. Splitting would
  scatter the "gathered once" invariant. Consciously accepted exception. Micro: the reset
  literal `{ capturing: false, lines: [], outbound: 'off', errors: {} }` appears at lines 213
  and 235 — an `IDLE_OVERLAY` const beside the existing `IDLE` is an honest one-liner, or skip it.
- **`UserRepository` is a 10-method interface.** No consumer needs all ten, and
  `packages/ai-providers` answers the same question differently (four narrow ports). Both are
  defensible; repository-per-aggregate is idiomatic. **Recommend leaving it** — noted only
  because the two modules differ in philosophy.
- **`PurposeTokenService` at 314 LOC** does two nameable things: purpose-bound token
  mint/verify, and AES-GCM seal/open with its own HKDF key. Extracting a `PayloadSealer`
  would leave ~230 LOC and make sealed-vs-signed structural. Low priority.
- **In-process rate limits.** Throttler and mail budget are per-process memory with no
  distributed backing. Not a bug at one instance, but the security reasoning in those comments
  is quantitative and assumes one process. `sessions.module.ts` already documents this
  constraint at its seam; these two do not. One comment each — no code change.

## Evidence that the short list is real, not a soft review

This codebase was written with an adversarial reviewer in the loop, which explains the low
defect rate rather than making it suspicious:

- `proxy-matcher.spec.ts` unit-tests a **middleware matcher regex** for over-match
  (`/registersomething` must still gate), and documents why it lives under `src/` — the vitest
  glob would otherwise never collect it ("passing by never running").
- `login/page.tsx:65-79` guards `?error=` lookups with `Object.hasOwn`, because the value
  comes straight off the query string and a bare index reaches the prototype chain.
- `login-form.tsx:30-37` documents a **fixed open redirect**: `?next=` is clamped through
  `sameOriginPath`, and the comment records that only the credentials path had been unguarded.
- `proxy.ts`'s matcher exempts `/verify-email` specifically because the redirect would
  otherwise copy a live token into `?next=` and into browser history.

## Recommendation

**Two small PRs, ~60 lines, no behavior change:**

1. **Hygiene + dead code** — delete the `update` chain (`UpdateUserDto`,
   `UserRepository.update`, `PrismaUserRepository.update`, `UsersService.update`), delete
   `UsersService.findByEmail`/`create`, drop the 5 redundant `export` keywords, delete the 3
   dead mobile theme aliases, drop `signIn`/`signOut` from `auth.ts:72`, clean the 5 stale
   `knip.json` entries, fix the 3 stale comments. Verify with `pnpm knip` → exit 0,
   `pnpm typecheck`, api tests.
2. **C1 helper** — extract `authErrorMessage` + spec, update the four forms.

**Do not do:** add OOP to `web`/`ui`; merge the token CSS, the socket twins, or the two
session services; split the cohesive state machines; refactor `api-client.ts`. Each trades a
documented, measured decision for a metric.

## Unresolved questions

1. Is `User.preferredLanguage` meant to be writable? Deleting the `update` chain leaves the
   column with no reachable writer — if a settings screen is planned, keep `update` and say so
   in a comment; if not, the column is a candidate for a later migration.
2. Is the mobile app on the roadmap? That decides whether C3's abstractions are scaffolding
   or dead weight.
3. Will the API ever run more than one replica? If yes, the throttler and mail budget need
   shared storage before that happens; if no, a comment at each site is enough.
4. Were `REGISTER_PURPOSE` / `PASSWORD_RESET_PURPOSE` exported intentionally as public
   vocabulary, or is the `export` vestigial?
