# Linking a glossary to an AI Context now works

2026-11-14

## What changed

- Linking an AI Context to a glossary had never worked. The save wrote the glossary's client UUID into `TranslationContext.glossaryId`, which is a foreign key to the glossary's cuid, so every link failed with P2003 and answered 500. The save now looks the glossary up under the caller (`ownerId_clientId`) after the advisory lock and stores its cuid. A glossary the caller does not own answers 400, and nothing is written.
- Reads return `linkedGlossary.clientId` for `glossaryId` and `linkedGlossaryId`. Echoing the stored cuid would fail the client's `uuid()` parse and drop the context from the list.
- `save` now returns `ContextSaveResult` (`saved`, `limit` or `glossary-missing`) instead of `TranslationContext | null`. The service switch ends in `assertNever`, built from `apps/api/src/common/library-scope/library-write-results.ts`. This is the first piece of the teamspace plan (`plans/261114-2126-teamspace`). The PR is #366.

## What the work found

- Before the change, prod had 0 contexts with a non-null `glossaryId`. That is consistent with the FK refusing every link, and it means the remap hides no existing row.
- Rollback is not code-only from here on. Older code echoes the cuid and silently drops linked contexts, so count linked rows before redeploying an older SHA.
- A fresh worktree does not typecheck the API until the workspace packages are built: `pnpm --filter "./packages/*" build`. Without that, `@chatofy/ai-providers` and `@chatofy/api-client` resolve to nothing.
- A glossary deleted between the lookup and the upsert still fails the FK and answers 500, because glossary delete does not take the owner lock. The window is narrow and nothing wrong is written. It is left for the scope hardening in phase 2.

## Later the same day: team schema and scoped library queries (PR #367)

- PR #366 merged as `b497cb22` and deployed successfully. Phase 2 of the teamspace plan is open as PR #367 and is not merged yet. Merging it deploys prod and runs the `add_teams` migration. That migration adds `Team`, `TeamMember` and `TeamInvite`, a nullable `teamId` on glossaries and contexts, and drops `Glossary_ownerId_fkey`.
- Every glossary and context store query now goes through `scopeWhere(scope)`. The personal form adds `teamId: null`, because a team row keeps its author in `ownerId`. The upserts are gone: an upsert on `(ownerId, clientId)` cannot carry that null.
- `prisma migrate dev --create-only` refuses to run outside an interactive terminal. The migration was generated with `prisma migrate diff --from-migrations … --to-schema … --script -o <tmp>`, written to a temp file first so an empty migration folder is never read, the same route CI uses. Use `-o` rather than a shell redirect, because stdout also carries Prisma's config banner.
- The new `personal-scope-isolation.db-e2e-spec.ts` is the gate for the leak. It seeds team rows through Prisma and calls all 10 personal routes with their ids. A personal PUT under a team row's id answers 500 from `@@unique([ownerId, clientId])`; that answer is accepted and documented, and the team row survives it.
- The manual dump `~/chatofy-backups/pre-add-teams-20261114T161316Z.dump` sits beside the pipeline's dumps, which are retained 14 at a time. Copy it elsewhere if it has to outlive that rotation.

## Teams core API (PR #368)

- PR #367 merged as `8ad036c8`. On prod, `add_teams` finished and `Team` holds 0 rows. `8ad036c8` is the rollback floor, recorded on #367: once teams exist, never redeploy anything older.
- PR #368 adds teams, members and roles. `TeamAccessService` reads membership on every request: 404 for a non-member, 403 for a member below the required role. It is the only place a team scope is minted.
- Review caught pool starvation. Member removal took the team advisory lock inside a transaction and then checked membership on a second pooled connection. 30 concurrent calls, even from a non-member, timed out the pool (P2028) and stalled unrelated queries for about 5 s. Membership is now checked before the transaction, and the caller's role is re-read on `tx`. Rule for later phases: while a transaction holds an advisory lock, never read on the shared client.
- Avatar keys are `avatars/{userId}/...`, so a teammate's avatar URL leaks their user id. The owner chose to show `avatarUrl` only on the viewer's own row. Teammates need initials in the Phase 6 UI.

## Team libraries API (Phase 4, in progress)

- #368 merged as `f2b9daad`, but its first main CI run failed: the extension e2e "signed-out pane missing or zero-width" flake, with 77 of 78 tests passing. CI failing makes the Deploy run skip, and prod answered 404 on `/teams` until the failed job was re-run. Re-running CI started a new Deploy, which succeeded, and `/teams` now answers 401. The post-deploy check has to read the Deploy conclusion: `completed skipped` is not a deploy.
- Team glossaries and AI Contexts are served under `teams/:teamId/...`. Any member reads and creates; only the author, an admin or the owner changes a row, checked inside each write's transaction. Team rows carry `canEdit`, and the author's id is never returned. A team create refuses a client id that any row of the model already uses (409). `GET /translation-contexts/available` returns the personal contexts plus one group per team, in join order.
- The context store passed 600 lines, so the row mapping moved to `stores/translation-context-row-mapping.ts`.
- Known and accepted: a personal create under an id the same user authored in a team still hits `(ownerId, clientId)` and answers 500. Two different scopes creating the same id at the same moment can both pass the `id-in-use` check, because the lock is keyed by scope.
- The assertion-diff gate (`git diff main -- <personal suites>`) needs a fresh `main` ref. Against a local `main` from before Phase 1 it reports Phases 1–2 as changes; against the branch base it prints nothing.
- #370 merged as `deb0be1c`. Main CI and Deploy succeeded on the first run, and prod `GET /translation-contexts/available` answers 401. Review found nothing blocking. Its two test gaps were closed before the merge: the author id is now checked on the raw body, because the zod helpers strip unknown keys; and the matrix now covers a member editing their own row plus admin PATCH, item add and delete. Left as low severity: a create racing its team's deletion answers 500, not 404, and a demotion takes effect one request late, because the role is read before the transaction.

## Team invites API (Phase 5, PR #371)

- #371 merged as `880236f0`. Main CI and Deploy succeeded, and prod `POST /team-invites/preview` answers 401. Prod invites now send real mail through SMTP, on the AttackerTriggerable budget shared with registration.
- Invite tokens are 32 random bytes in base64url. Only their sha256 is stored, and the raw token appears only in the mailed link. Preview spends nothing. Accept requires the invited address. A refused accept answers 409 `INVITE_NOT_PENDING`, whose `details` name the status, and `CodedHttpException` can now carry `details`.
- The API's repeat-invite window is 11 minutes, one longer than the mail guard's 10, because the guard counts from the send, which lands a moment after the invite row exists. The refusal says "sent recently" rather than naming a number.
- A concurrent second accept answers 409 `accepted`, not 200: `statusOf` reads a spent invite as spent before it checks membership. Only one membership is created.
- The dev console check ran a local API without the root env file. It used a generated JWT secret plus the placeholder Meetings keys the test setup uses (`test-realtime-app-id` and `test-realtime-app-secret`); the Meetings module refuses to boot without them.

## Teamspace Phase 6a — the invite page (PR #372, 2026-11-15)

The owner split Phase 6 in two, with `/invite` first: shipping the Team tab first would have mailed links to a route that did not exist yet. Kongming's go/no-go also changed the copy. Invite create answers 429 both for the 5/min throttle and for the 20/day cap, and a client cannot tell the two apart, so `inviteTooMany` is now neutral copy. A `wrong-account` invitee had no way off the page, so it gained a sign-out (owner decision) that keeps the pending token.

What bit:

- **A plan Verify could not pass as written.** `grep -c "invite\$|invite/"` reached grep as `invite$|invite/`, where `$` is an anchor, so it printed 0 against a correct matcher. Kongming confirmed it, and the phase file now uses `grep -cF`.
- **Lint `--fix` removed a type assertion the typecheck needed.** The cast `as { data: unknown; … }` inside `vi.hoisted` was stripped as unnecessary, and `session.value = { data: { user } }` then failed TS2322. A typed local inside the hoisted factory survives the fixer.
- **`token` narrowing went through a derived value.** `outcome` excluded `null`, but TypeScript does not trace that back to `token`, so the join closure saw `string | null`. An explicit `token === null` render guard fixed it.
- **The skin guard caught `text-sm`.** The project's type scale is by role, so the class is `text-hint`.
- **Verify tokens contain dots.** A live-check script that parsed links with `[A-Za-z0-9_-]+` cut the token short and verify answered 401. Invite tokens have no dots; verify tokens do.

The live new-account path passed: invite to an address with no account, then register, verify in a new tab and sign in, landing on `/invite` with Join. None of the 24 recorded URLs carried a token besides the two mailed links.

- #372 merged as `020f0bc2` after kongming's review (GO, posted on the PR). Before merging, at the owner's choice, it gained three fixes. A session that can no longer renew, or a preview answering 401, now gets sign-in links instead of a retry that cannot succeed. A malformed `?token=` never falls back to an older stored invite. After a join the URL becomes `/invite?joined=1`, so a reload shows the join. Main CI and Deploy succeeded, and prod `GET /invite` answers 200 signed out.
- Left for 6b:
  - a kept invite (wrong-account or a cap) sends a later verify on that device to `/invite`;
  - "5" is hard-coded in the `teamCap` copy;
  - spec cases for accept 403 and 404;
  - unverified: whether the Cloudflare beacon reports query strings (if so, this exposure also exists on `/verify-email` and `/reset-password`).

## Teamspace Phase 6b — workspace switcher and Settings › Team (PR #373, 2026-11-15)

The second half of Phase 6 added the workspace provider and switcher (sidebar plus the More sheet below `md`), and a Team tab in Settings: create, members, invites, rename, delete and leave. It also closed three items left over from 6a. An invite kept on a device for a capped account no longer sends a later verify to `/invite`. `teamCap` and `createRefused` take `{max}` from `TEAM_LIMITS`. And the spec now covers accept 403 and 404.

What bit:

- **The accent gate rendered nothing for the switcher rows.** Radix menus portal out of the container, so the container text was empty. Kongming's advice was to render `historyRoute()` beside the trigger, as other portal-only rows do.
- **Six provider specs failed with "destroy is not a function".** A probe effect's concise arrow returned a value, and React called it as a cleanup. A block body fixed it.
- **The team spec reached 219 lines.** Its fixtures moved to `team.fixture.ts`.
- **The commit hook ran pnpm 8.** `~/.local/bin` came before Node v26 on PATH, and fixing the PATH order fixed it.

Review fixes, at the owner's choice:

- Manage teams from the More sheet now closes the sheet before opening Settings.
- A 404 on rename, delete or leave goes back to personal instead of showing an error.
- A team-list reload no longer remounts the open team view.

The live check passed 9 of 9: create, a pending invite, the owner's Settings and switcher at 1440, 768 and 375, and the invitee's join. At 375 the menu looked transparent in one screenshot, but only mid-animation.

- #373 merged as `616619c8`. Main CI and Deploy succeeded on the first run. Prod `GET /invite` answers 200 and `GET /teams` answers 401 signed out.
- Left for Phase 7:
  - the 403 copy for an admin demoted mid-session;
  - a failure state for the invites list;
  - a reason when Leave is disabled;
  - the switcher shows Personal while the workspace resolves;
  - vi and zh wording nits;
  - the Cloudflare beacon question, still unverified.

## Teamspace Phase 7a — grouped translate picker (PR #374, 2026-11-15)

Kongming's go/no-go for Phase 7 was GO with 13 corrections to the plan, recorded as Amendments in the phase file. The owner split Phase 7 into two PRs, picker first. The order is forced: once the library hook follows the workspace (7b), `/translate` must already read `/translation-contexts/available`, or the picker would be filtered by workspace.

- #374 merged as `16dd66b5`. Main CI and Deploy succeeded on the first run, and prod `GET /translation-contexts/available` answers 401 signed out.
- The picker shows personal contexts, then each team's under its name. A reader in no team gets one unlabelled group, which renders the same DOM as before. An id held by two teams resolves to none.
- Fixes carried over from the 6b review:
  - A 403 from a team route now reloads the teams, as a 404 does.
  - The invites list has a failure state with Retry.
  - The switcher checks no workspace while it resolves.
  - Two vi wordings and one zh wording were fixed.
- Plan steps that failed as written:
  - **`context-picker.spec.tsx`** was missing from the plan; it renders `contexts=` 12 times.
  - **The Task 7.4 Verify** used `origin/main...HEAD`, which is vacuous before a commit.
  - **Task 7.7** assumed `client.session.start` fires on Start, but it fires per turn. The browser run fed a speech WAV to `--use-file-for-fake-audio-capture`, and the frame arrived.
- Lint `--fix` reformatted a line and exposed two `noUncheckedIndexedAccess` errors. Running lint before typecheck caught them.
- Live run, 7 of 7 pass: the groups render, the team hints reach `session.start`, the selection survives a reload, and all three viewports fit. The open menu screenshots taken mid-fade looked transparent. A settled capture after 800 ms renders normally.
- Kongming's PR review (GO, posted on the PR) left seven non-blocking notes, carried into 7b:
  - spec gaps for the flat DOM, the form disappearing after a 403, and a 403 on a list read;
  - two stale comments;
  - export `teamListIsStale`;
  - a `reload` for the picker list.

## Teamspace Phase 7b — team libraries (PR #375, 2026-11-15)

`/glossary` and Settings › AI Context now list and edit the active workspace's library. A team's rows that the reader may not edit open view-only.

How the scope rules were built:

- **One shared core.** The glossary and context hooks share `use-scoped-library.ts`. Each read is tagged with the scope it was for, a generation counter drops stale replies, and every write takes a scope captured when its editor or toast was made.
- **Glossary items** follow the list's scope (`useGlossaryItems(id, teamId)`), not the live workspace.
- **Picker refresh.** A library write tells the translate picker to refetch (`lib/library-changed.ts`).

What bit:

- **Specs read trailing `undefined` two ways.** vitest's `toHaveBeenCalledWith(a, b)` still matched a call `(a, b, undefined)` when the mock wrapper dropped arguments. Only `ai-context-section.spec.tsx`, whose mock forwards `...args`, needed the trailing `undefined`. The plan's list of seven glossary assertion lines did not need to change.
- **`ApiClientError` codes are a closed union.** A spec code `'REFUSED'` failed typecheck, so the specs map 404 to `NOT_FOUND` and 403 to `FORBIDDEN`.
- **Throwaway cleanup left orphan rows.** Deleting a throwaway `User` left its personal `Glossary` and `TranslationContext` rows behind: `ownerId` has no foreign key to `User` (only `teamId` does). On the throwaway DB the orphans were deleted by `ownerId NOT IN User`. On prod this is a question for account deletion, not for this phase.

- #375 merged as `ef82ba1f`. Main CI and Deploy succeeded on the first run, and prod `GET /teams/:id/glossaries` answers 401 signed out.

Live run, 12 of 12 pass:

- team scope lists only the team's glossaries;
- the note names the team;
- a teammate's glossary opens view-only;
- a glossary created in team scope lands in the team (API read);
- personal scope shows personal only;
- Settings › AI Context shows a team context view-only;
- both screens fit at three viewports with one h1.

Kongming's review (GO) left 8 non-blocking notes. At the owner's choice, three were fixed before the merge:

- A refused term write now reloads the glossary list.
- The picker can no longer stick on loading when a refetch superseded its first read.
- A refused term read reloads the teams.

Left for Phase 8:

- a team draft that survives a fallback to personal;
- spec gaps:
  - a write that answers 403;
  - Retry while resolving;
  - captured scope on `/glossary`;
  - `draftScope` after a switch;
- the glossary gate rows' `shows:` should be the team note;
- teammates' edits reach the picker only on the next mount.

## 2026-11-15 — Phase 8a: library follow-ups (#376)

**Merged.** #376 merged as `a3facedb`. Main CI and Deploy both succeeded. Prod `robots.txt` no longer lists `/invite`, and `/invite` answers 200.

**The library follow-ups closed:**

- **Draft scope.** A team AI Context draft is shown only in the library it was opened in, and saves there.
- **Spec cases added.** Four of them:
  - a team write that answers 403;
  - Retry while the workspace resolves;
  - a glossary created after a switch keeps its team;
  - a draft survives a switch away and back.
- **robots.** `/invite` left `robots.ts` and keeps `noindex`, like the other token pages. Before that, on prod, the RUM beacon on all three token pages was checked to report `location` without the query.

**Review fixes before the merge.** Kongming's review (merge, 0 blocking, 6 notes) found two worth fixing, and the owner chose to fix them first:

- **Hidden draft.** Hiding the draft outside its library hid the inline failure too. A team save refused after the reader left the team lost the text silently. One error toast now names the context.
- **Gate rows.** The team gate rows' `shows:` matched the note and the badge, which render before the list loads. They now require a listed row and loaded terms.

**What bit:**

- **The toast effect.** The first version cleared `saveFailed` from inside the effect, which `react-hooks/set-state-in-effect` flags. A ref now records which failure was announced.
- **The spec mock.** It forwarded `teamId` unconditionally. That turned every personal call into `(id, body, undefined)`, which broke the older two-argument assertion. It now forwards `teamId` only when one is set.

**Left open, accepted:**

- Resolving and personal are the same scope to a draft.
- A hidden draft is overwritten by opening another.

## 2026-11-15 — Phase 8: docs and prod replay

**Docs PR.** #377 describes teams as built. It adds the new `docs/architecture/teams-and-shared-libraries.md` and points the index, summary, auth, data flow, extension, deployment, roadmap, state inventory, checklist and the CLAUDE.md tree at it.

**Prod replay.** Run with no Deploy in progress, after a fresh `pg_dump`, with two throwaway `@example.com` accounts. Tokens were minted inside the API container and held only in memory. Every status matched:

- `/auth/me` answered 200 for both accounts;
- team create 201, team context 200, invite 201;
- preview 200 `pending`, accept 200, a second accept 409;
- `/translation-contexts/available` contains the team context, and the personal `/translation-contexts` does not;
- removing the member answered 204; right after, the member's team read answered 404 and the team left their `/teams`;
- team delete answered 204.

**Cleanup.** Every count by user id came back 0: `User`, `TeamMember`, `TeamInvite`, `Glossary`, `TranslationContext`, `UserPreferences`, the credit tables and `ConferenceParticipant`.

**AC11, proved statically.** Ten teamspace merges are on `origin/main`. None touched the credits, translate or realtime-event code. The schema has three `Team*` models, and no `Credit*` model has a `teamId`.

**What bit:**

- **The plan assumed the monorepo layout in the container.** The prod API image is rooted at `apps/api`, so `/app/apps/api` does not exist. Plain SQL through `psql` and an HS256 signature from `node:crypto` replaced the Prisma script.
- **A doc sentence.** It said accepting again is idempotent, but the replay's second accept answered 409. Both are right: an open invite to a team the caller already belongs to is idempotent, and a link already used is `accepted` (409). The doc now says both.
