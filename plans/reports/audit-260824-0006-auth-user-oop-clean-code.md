# Audit — auth / users: OOP & clean code

Date: 2026-08-24 · Branch `main` · Scope: `modules/auth`, `modules/users`, `modules/mail` ·
Mode: read-only

Companion to `audit-260824-0006-auth-user-security.md` (security lens) and
`audit-260823-2353-oop-clean-code-redundancy.md` (repo-wide). **This one answers the original
question — OOP and clean code — for the recently-landed auth/user code.**

## Verdict

Design is sound; SOLID is applied deliberately, not decoratively. But this module contains the
audit's **only real dead code** — a 4-file chain that `knip` structurally cannot see, plus a
facade whose majority is unreachable. That is a better answer to "dùng đến nhưng cũng thừa"
than anything in the repo-wide pass.

## What is genuinely good

**SRP — the PR #87 split is correct.** One `AuthService` became three flow services that share
_collaborators_, not logic:

```
AuthService          sign in, Google linking     ─┐
RegistrationService  register, verify email      ─┼─ PasswordHasher · AuthMailer
PasswordResetService forgot, reset  (REVOKES)    ─┘   PurposeTokenService · normalizeEmail
```

The cut is along a real seam: `PasswordResetService` is the only flow that revokes, so "what
does a reset invalidate?" is answerable from one file instead of a method name buried in a
480-line service.

**DIP, consistently.** Every collaborator is injected behind an interface + Symbol token
(`USER_REPOSITORY`, `AUTH_ADAPTER`, `MAIL_SENDER`, `SESSION_STORE`). `SessionTerminator`
inverts the dependency so transports register themselves and auth cannot name the gateway —
`TranslateModule` already imports `AuthModule`, so the other direction would be a cycle.

**LSP with real substitution.** `MailSender` has five implementations (Smtp / Console / Noop /
Guarded / Recording) — the interface earns its keep rather than existing for symmetry.
`GuardedMailSender` is a decorator over another `MailSender`, which is the right pattern for
cross-cutting cooldown + budget.

**DRY where it matters, with the invariant stated.** `AuthMailer` exists because two flows both
need dispatch to be detached identically — its docstring says "two copies of
`void Promise.resolve().then(...)` is exactly how one of them quietly grows an `await`".
`normalizeEmail` is a free function in its own file so identity means the same thing in all
three flows. `PasswordHasher` names argon2 in exactly one place.

**Clean boundaries.** `toUserContract` maps field-by-field and pins its return to the wire
type, so internal columns cannot leak and drift is a compile error. Token payloads are likewise
built field-by-field, never spread.

## Findings

### F1 — Dead `update` chain across 4 files (~25 LOC). Delete.

Traced end to end; **nothing calls it**:

```
UpdateUserDto (interface, 4 lines)
  └─ UserRepository.update           (declaration)
       └─ PrismaUserRepository.update (14-line impl)
            └─ UsersService.update    (3-line passthrough)
                 └─ ✗ no caller
```

Verified by call-site sweep: the only reference to `UserRepository.update` is the passthrough in
`UsersService.update`, and the only reference to _that_ is its own definition. The three auth
services all write through `create` / `updatePasswordHash` / `linkGoogleSub` instead.

Side effect: `UpdateUserDto.preferredLanguage` is the sole write path to the
`User.preferredLanguage` column, so that column currently has **no reachable writer**.

**`knip` cannot find this** — it reports unused _exports_, and these are public methods on
classes that are themselves exported and used. This is the category the repo-wide audit could
not reach by tooling alone.

### F2 — `UsersService`: 3 of 5 methods dead, and two docstrings disagree

| Method              | Caller                          |
| ------------------- | ------------------------------- |
| `findById`          | `JwtAuthAdapter.getUser` ✅     |
| `findAuthStateById` | `JwtAuthAdapter.verifyToken` ✅ |
| `findByEmail`       | none ✗                          |
| `create`            | none ✗                          |
| `update`            | none ✗ (F1)                     |

The `UsersService` / `USER_REPOSITORY` **split itself is justified** — `users.module.ts`
documents it as privilege separation: the repository carries credential and Google reads that
"[have] no business on a general-purpose service every module can inject." That is interface
segregation by privilege, and it is a good reason. Auth services legitimately go direct.

But the class's _own_ docstring tells a different story: _"Place domain validation / business
rules here (not in the repository)."_ That is a scaffold comment for logic that never arrived,
and it contradicts the module's real rationale. Given the privilege framing, `UsersService`
should be the **narrow, non-secret** surface — which is exactly two methods, not five.

**Recommendation:** delete `findByEmail`, `create`, `update` from `UsersService`; replace the
class docstring with the privilege-separation rationale from `users.module.ts`. Combined with
F1 this removes a dead layer without touching the seam that earns its keep.

### F3 — `UserRepository` is a 10-method interface (ISP judgment call, not a defect)

No consumer needs all ten:

| Consumer               | Methods used                                                           |
| ---------------------- | ---------------------------------------------------------------------- |
| `AuthService`          | `findCredentialsByEmail`, `findByGoogleSub`, `create`, `linkGoogleSub` |
| `RegistrationService`  | `findByEmail`, `create`                                                |
| `PasswordResetService` | `findCredentialsByEmail`, `findCredentialsById`, `updatePasswordHash`  |
| `UsersService`         | `findById`, `findAuthStateById` (after F2)                             |

Worth noting because the repo is **inconsistent about ISP across modules**:
`packages/ai-providers` deliberately split into four narrow ports rather than one fat
`AIProvider`, while this is one wide port per aggregate.

Both are defensible — repository-per-aggregate is the idiomatic pattern, and splitting into
role interfaces (`CredentialsReader`, `PasswordWriter`, `GoogleLinker`) would add three
abstractions to serve four consumers in one module. **My recommendation: leave it.** Flagging
only because the two modules answer the same question differently, and you may want that noted
somewhere rather than rediscovered.

### F4 — `PurposeTokenService` at 314 LOC carries two responsibilities

It is the largest auth file and does: (a) mint/verify registration tokens, (b) mint/verify reset
tokens, (c) AES-256-GCM seal/open of the password-hash payload, with its own HKDF-derived key.

(a) and (b) are cohesive — both are purpose-bound link tokens sharing key derivation. (c) is a
genuinely separate concern: it has its own key, its own failure mode, and its own format, and it
is used by exactly one of the two token types.

Extracting a `PayloadSealer` (seal / open / `payloadKey`) would leave the token service ~230
LOC and make the sealed-vs-signed distinction structural rather than a naming convention. **Low
priority** — cohesion is high and the comments carry the distinction well. Listed because it is
the one place in auth where a class does two nameable things.

## Not findings (checked, dismissed)

- **`AuthAdapter` with one implementation** — not speculative generality: it is the seam
  `JwtAuthGuard` and the WS gateway both route through, so neither carries its own token check
  and neither can drift.
- **Parallel shape of `RegistrationService.register` and `PasswordResetService.forgotPassword`**
  — both are normalize → look up → branch → dispatch → uniform message, but the branches differ
  in mail purpose, budget class and token type. Shared shape, not shared logic; the genuinely
  common part is already extracted into `AuthMailer`.
- **File sizes** — largest auth file is 314 LOC. Nothing here trips the 200-LOC rule the way the
  realtime state machines do.
- **`user-repository.interface.ts` holding 8 exports** (3 record types, an error class, 2 DTOs,
  the port, the token) — co-locating a port with its data contracts is conventional; splitting
  would scatter one contract.

## Recommendation

**One cleanup PR, ~30 lines removed, no behavior change:**

1. Delete the `update` chain: `UpdateUserDto`, `UserRepository.update`,
   `PrismaUserRepository.update`, `UsersService.update`.
2. Delete `UsersService.findByEmail` and `UsersService.create`.
3. Replace the `UsersService` class docstring with the privilege-separation rationale.
4. Run `pnpm typecheck` + `pnpm test --filter api` to confirm nothing depended on them.

Leave F3 and F4 alone unless you want them; both are judgment calls, neither is a defect.

## Unresolved questions

1. Was `User.preferredLanguage` meant to be writable? Deleting the `update` chain leaves the
   column read-only — if a settings flow is planned, keep `update` and say so in a comment;
   if not, the column is also a candidate for removal in a later migration.
2. `UsersService` — keep as the narrow non-secret surface (2 methods), or drop it entirely and
   let `JwtAuthAdapter` inject `USER_REPOSITORY` like the three auth services do? The privilege
   argument favors keeping it; the KISS argument favors dropping it.
3. Still open from the first audit: were `REGISTER_PURPOSE` / `PASSWORD_RESET_PURPOSE` exported
   intentionally as public vocabulary?
