# Teams and Shared Libraries

Part of the [system architecture](../system-architecture.md).

A signed-in web user can create a team, invite people by email, give them a role, and
switch the web app between their personal space and a team. Inside a team, members
share AI Contexts and glossaries and use them in their own translate sessions.

## What is shared and what is not

Shared: AI Contexts and glossaries. A team's library lives in the same tables as
personal ones, told apart by `teamId` (`apps/api/prisma/schema.prisma`).

Not shared: history, recordings, minutes, meetings and credits. A session started with
a team context is the member's own session and debits only the member's ledger. No
`Credit*` model has a `teamId` and there is no team balance model
(`apps/api/prisma/schema.prisma`); the translate path receives a team context as the
same inline hints a personal one produces, so it never learns which library it came
from. Team billing, seats pricing and sharing history are out of scope, not deferred
work.

## Data model

The owner is `apps/api/prisma/schema.prisma`.

- Three tables: `Team`, `TeamMember`, `TeamInvite`. `Team` has no creator column; the
  owner is the `TeamMember` row with `role = 'owner'`, so there is one source of truth for
  who may rename or delete the team.
- `TranslationContext` and `Glossary` each gain a nullable `teamId`, a foreign key to
  `Team` with cascade, so deleting a team deletes its library. `ownerId` stays the
  author on a team row.
- Each of the two gets a second unique, `(teamId, clientId)`, beside the existing
  `(ownerId, clientId)`. Postgres treats NULLs as distinct, so personal rows are
  unaffected by it. Each also gets an index on `clientId` alone, which serves the team
  create check in the next section.
- No foreign key to `User`. `Glossary.ownerId` and `TranslationContext.ownerId` are
  plain columns, and so are `TeamMember.userId` and `TeamInvite.invitedById`. The only
  relation `User` has is `UserPreferences`. Team rows deliberately survive their author.

No account deletion exists today. Whoever builds one must delete the user's personal
library rows by `ownerId` with `teamId` null, and the user's `TeamMember` rows, or a
deleted account stays a member and possibly an owner.

## Scoping invariant

Every library store query builds its `where` through `scopeWhere(scope)`
(`apps/api/src/common/library-scope/library-scope.ts`). Its personal form is `ownerId`
plus `teamId: null`. The `teamId: null` is the point: a team row carries its author in
`ownerId`, so a filter on `ownerId` alone would let the author list, rename and delete
team rows from the personal routes, even after leaving the team.

A `TeamScope` is a branded type minted only by `mintTeamScope`, whose only caller is
`apps/api/src/modules/teams/team-access.service.ts`. That service reads `TeamMember` on
every request, never the JWT, so a removal or role change applies on the next request.
A non-member gets 404 on every team route, so a team's existence is not revealed; a
member below the required role gets 403.

A team create refuses a `clientId` that exists in any row of the model, in any scope,
with 409 (`id-in-use` in
`apps/api/src/modules/glossaries/stores/prisma-glossary.store.ts` and
`apps/api/src/modules/translation-contexts/stores/prisma-translation-context.store.ts`).
Why: the translate picker resolves a stored id across every scope the reader can use,
so without the check one team could plant a context under an id another member had
already selected.

## Roles and member privacy

| Action                                    | owner                        | admin              | member                      |
| ----------------------------------------- | ---------------------------- | ------------------ | --------------------------- |
| Read and use team contexts and glossaries | yes                          | yes                | yes                         |
| Create team resources                     | yes                          | yes                | yes                         |
| Edit or delete any team resource          | yes                          | yes                | only the ones they authored |
| See teammates' emails                     | yes                          | yes                | no (own row only)           |
| Invite `member`                           | yes                          | yes                | no                          |
| Invite `admin`, change roles              | yes                          | no                 | no                          |
| Remove a member                           | yes                          | yes (members only) | no                          |
| Remove an admin                           | yes                          | no                 | no                          |
| Leave                                     | no (delete the team instead) | yes                | yes                         |
| Rename or delete the team                 | yes                          | no                 | no                          |

The author rule is `canEditRow` in
`apps/api/src/common/library-scope/library-scope.ts`; the member rules are in
`apps/api/src/modules/teams/team-members.service.ts`. No role ever receives another
member's user id: member routes take the `TeamMember` id, and a plain member's list
carries no teammate email.

## Limits and advisory lock classes

`TEAM_LIMITS` in `packages/types/src/http/teams.ts` owns the numbers:

- teams per user, counting owned and joined;
- seats per team, counting members plus live invites when inviting, and members alone
  when accepting;
- contexts and glossaries per team;
- invite lifetime and invites per inviter per day.

`apps/api/src/common/library-scope/advisory-lock-classes.ts` owns the lock classes. Each
library resource has one class for every scope, keyed by the user id for personal and
the team id for a team; ids from different tables do not collide by design, so a
`hashtext` collision costs only a wait. Team membership has one class, keyed by team for
a team's members and invites and by user for one user's counts
(`apps/api/src/modules/teams/team-locks.ts`). When a transaction takes both, the user
key comes first, which rules out a deadlock between invite create and accept.

## Invites

Owners: `apps/api/src/modules/teams/invites/` on the API, `apps/web/src/lib/pending-invite.ts`
and `apps/web/src/components/team/invite-accept-client.tsx` on web.

- **Token.** 32 random bytes, base64url, 43 characters. Only its sha256 hex is stored,
  in `TeamInvite.tokenHash`, so a database read cannot recover a usable link
  (`apps/api/src/modules/teams/invites/team-invite-token.ts`). Invites expire after 7
  days and are single use: the claim sets `acceptedAt` in the accept transaction.
- **Bound to the address.** Accept requires the caller to be signed in as the invited
  email. Another account gets 403 and the token stays unspent.
- **Preview, then accept.** `POST /team-invites/preview` spends nothing;
  `POST /team-invites/accept` joins. Both derive the status through one function, so they
  never disagree, and the statuses are one enum (`packages/types/src/http/team-invites.ts`).
  A refused accept answers 409 `INVITE_NOT_PENDING` with the status in `details`, so no
  client matches on message text. An unknown token, or one whose team was deleted, is 404. An open invite to a team the caller already belongs to answers 200 and stays unspent; a link already used answers 409 with `accepted`.
- **No team name in the mail.** The mail copy is static
  (`apps/api/src/modules/mail/interfaces/mail-sender.interface.ts`): a team name is text
  the inviter chose, and a team named like a security notice would be phishing from the
  product's own domain. After sign-in the page shows the inviter's email and the team
  name as plain text.
- **Mail budget.** The invite mail is `AttackerTriggerable`, the tier registration
  mail draws on, because the inviter names an arbitrary recipient. The route also caps
  invites per inviter per day, and refuses an address any team invited in the last 11
  minutes. The mail guard's own cooldown is 10 minutes, counted from the send, which lands
  just after the row is written; the extra minute keeps the API from answering 201 for a
  mail the guard would drop (`apps/api/src/modules/mail/senders/guarded-mail.sender.ts`).
  See [Mail cannot be aimed at a mailbox](./authentication.md#mail-cannot-be-aimed-at-a-mailbox-or-at-the-product).
- **No resend.** To repeat an invite, withdraw it and invite again. Every mail is one
  row, so the daily cap counts every mail sent.

On web, `/invite` is outside the proxy matcher (`apps/web/proxy.ts`), like
`/verify-email`: a sign-in redirect would copy the token into `?next=`. On first client
render the page moves the token into `localStorage` `chatofy.pendingInvite` and strips
it from the URL. localStorage rather than sessionStorage, because a new invitee
registers and then opens the verify link in a new tab; verify continues to
`/login?verified=1&next=/invite` while an invite is pending
(`apps/web/src/components/auth/verify-email-client.tsx`). Signed out, the page links to
sign in and register without the token. A `wrong-account` outcome offers Sign out; a
join replaces the URL with `/invite?joined=1`; `team-cap` and `team-full` keep the
stored invite but stop it steering later sign-ins (`apps/web/src/components/team/invite-outcome.tsx`).

The page is `noindex` (`apps/web/app/(auth)/invite/page.tsx`) and is not disallowed in
`robots.txt`, like the other two token pages: a crawler must be able to fetch it to read
the `noindex`.

## Workspace on web

The workspace decides what a screen manages: `/glossary`, Settings › AI Context and
Settings › Team. It never filters what translate offers.

- **Storage.** One localStorage key, `chatofy.workspace`, holding `{ userId, value }`,
  where `value` is `'personal'` or a team id. An entry written for another user is
  ignored, and the key is forgotten on sign-out next to the preferences cache
  (`apps/web/src/lib/workspace-store.ts`,
  `apps/web/src/components/preferences/preferences-provider.tsx`).
- **Resolving.** The workspace is `resolving` while the session or `GET /teams` loads,
  and also when `GET /teams` fails: the screen shows an error and a retry, and the stored
  choice is kept. Only a successful team list that lacks the stored id falls back to
  personal (`apps/web/src/components/workspace/workspace-provider.tsx`).
- **No cross-tab follow.** A tab reads the key on mount and follows only its own writes.
  A tab with an editor open must not change scope because another tab switched.
- **Writes keep their scope.** A list follows the workspace, but each write carries the
  scope its editor captured when it opened (`apps/web/src/hooks/use-scoped-library.ts`).
  A 403 or 404 from a team write reloads the teams and the list.

**The picker.** `/translate` reads `GET /translation-contexts/available`, every context
the reader may use, grouped by scope
(`apps/web/src/hooks/use-available-translation-contexts.ts`). A stored `contextId`
resolves to the personal context with that id; else to a team context only when exactly
one team holds it; else to none. An id two teams hold can only come from the create race
below, and resolving it by team order would let a teammate plant a context under an id
another member selected. The resolved context travels as inline hints, unchanged; see
[AI Context, and the path a hint takes to the prompt](./data-flow.md#ai-context-and-the-path-a-hint-takes-to-the-prompt).

## Clients

Team UI is web only. The extension reads the personal `GET /translation-contexts` only
(`apps/extension/src/translation-contexts.ts`). The selected `contextId` is an account
preference shared across clients, so a team context selected on web resolves to none in
the extension. Mobile reads no context list and has no AI Context picker. Personal
routes kept their paths and response shapes, which is why neither client changed.

## Known behaviours

These are accepted, not open defects:

- A removed member's running session keeps the inline hints it started with. Hints are
  resolved on the client at session start; removal applies on the next request.
- A team context is an instruction channel into every member's prompt. It is fenced as
  data and held to the same caps as a personal context
  ([data flow](./data-flow.md#ai-context-and-the-path-a-hint-takes-to-the-prompt)).
- A personal create that reuses one of the author's team client ids answers 500: it
  collides with the `(ownerId, clientId)` unique. Clients mint random UUIDs, so a real
  client never sends one.
- Two concurrent team creates of the same client id in two teams can both succeed,
  because each takes only its own team's lock. The picker resolves that id to none.
- Teammates' edits reach the picker on its next mount, or after a library write in the
  same tab (`notifyLibraryChanged` in `apps/web/src/lib/library-changed.ts`). There is no
  push from other members.
- An admin demoted while Settings › Team is open briefly sees the admin-only refusal
  copy; the 403 reloads the teams and the view corrects itself.
- A team AI Context draft is shown only in the library it was opened in. If its save is
  refused because the reader left the team, the workspace falls back and an error toast
  names the context, since the inline failure went with the hidden editor
  (`apps/web/src/components/settings/ai-context-section.tsx`).
- A glossary or context write lands in the scope where its editor was opened, even after
  a workspace switch (`apps/web/src/hooks/use-scoped-library.ts`).

## Rollback floor

Once `"Team"` has rows, never redeploy a ref older than
`8ad036c86be6d86e3ffbcfb1afc172a1a453eb09`, the merge that added the teams migration
and `scopeWhere`. Code older than that matches the personal library routes on `ownerId`
alone, so an author would list, rename and delete team rows, even after leaving the
team. Fix forward instead. The check to run before a dispatch is in
[deployment-guide.md § Rollback](../deployment-guide.md#rollback); the migration is
under `apps/api/prisma/migrations/`.
