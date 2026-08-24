---
phase: 2
title: 'Host prep and prod env'
status: pending
priority: P1
effort: '1-2h'
dependencies: [1]
---

# Phase 2: Host prep and prod env

## Overview

Create the durable host-side state the prod stack reads: the real secret env
file (outside the repo), the model directories referenced by absolute path, and
the backups directory. Nothing here is committed except an example file.

## Requirements

**Functional**

- `~/.config/chatofy/prod.env` exists, chmod 600, with every value the prod stack needs.
- `STT_MODELS_DIR` / `TTS_MODELS_DIR` point at real, populated absolute paths.
- `~/chatofy-backups/` exists.
- A committed `prod.env.example` documents every required key.

**Non-functional**

- No secret is committed, and none is ever sent to GitHub.
- Prod secrets are **distinct** from dev secrets — a leaked dev value must not unlock prod.

## Architecture

### Why the env file lives outside the repo

The runner checks out into its own workspace and re-syncs it each run; anything
inside is transient. More importantly, the deploy target _is_ this machine, so
putting `AUTH_JWT_SECRET` / `SMTP_PASS` / `GEMINI_API_KEY` into GitHub Actions
secrets would round-trip them through a third party only to land back here —
strictly more exposure (workflow logs, GitHub itself) for zero benefit.

`~/.config/chatofy/` over `/etc/chatofy/`: the runner runs as this user, so
updates need no sudo.

The auditability normally gained from GitHub secrets is recovered cheaply by
committing `prod.env.example` listing every key with comments.

### Model directories (C8)

`services/local-*/models/` is gitignored with **0 tracked files** — the weights
(1.3GB stt + 354MB tts) exist only in this working tree. A relative bind mount
resolves against the _runner's checkout_, which will contain empty directories,
and the sidecars would boot with no models.

Two viable targets, either fine as long as the path is absolute:

- Point at the existing dev clone's dirs (zero copying, couples prod to this checkout's location).
- Copy once to a neutral location (decoupled, costs 1.7GB more disk of the 180GB free).

Prefer the neutral location: a prod stack that breaks when the dev checkout moves
is not really deployed. Mount read-only in prod either way.

**Chosen: `~/chatofy/models/{stt,tts}`** — no sudo, decoupled from the checkout.
Verified: the sidecars start against it with a `:ro` mount, because the download
step no-ops when the weights are already present.

### Values that are forced, not chosen

| Key                        | Value                                          | Why                                                                                                                              |
| -------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                 | `production`                                   | C1 — the enum has no `staging`                                                                                                   |
| `WEB_BASE_URL`             | `https://chatofy.quanganh208.dev`              | C2 — the default value refuses to boot; also the origin of every mailed link                                                     |
| `CORS_ORIGIN`              | `https://chatofy.quanganh208.dev`              | Exact origin, not `*` — `main.ts` enables credentials mode only when it is not `*`                                               |
| `SMTP_HOST/PORT/USER/PASS` | all four filled, or all four COMMENTED OUT     | Revised C2 — absent makes the API refuse to boot (loud, safe); present-but-empty boots silently with a broken sender (dangerous) |
| `TRUST_PROXY_HOPS`         | `1` provisionally                              | C5 — **measured and corrected in Phase 3**                                                                                       |
| `DATABASE_URL`             | points at prod postgres on the compose network | Not the dev database                                                                                                             |

`NEXT_PUBLIC_API_BASE_URL=https://chatofy-api.quanganh208.dev` is a **build ARG**
and belongs in the compose file, not this secret env file (C3).

## Related Code Files

- Create (host, uncommitted): `~/.config/chatofy/prod.env`
- Create (host): `~/chatofy-backups/`, model dirs at the chosen absolute path
- Create (committed): `prod.env.example` at repo root
- `.gitignore` needs NO change — `prod.env.example` is already committable (C17)

## Implementation Steps

1. **Understand what `.gitignore` actually matches — the risk runs the opposite way to the obvious reading (C12).** Measured with `git check-ignore -v`: `.env.prod` **is** ignored (matches `.env.*`), while `prod.env` and `prod.env.example` are **not** — those patterns only match basenames beginning `.env`. So no negation is needed for `prod.env.example`; it is already committable. The real hazard is the inverse: a file named `prod.env` holding real credentials sits in the tree fully stageable. Keep every real env file **outside the repo**, and if a temporary in-tree one is ever needed, name it `.env.prod`. Re-verify with `git check-ignore -v` rather than trusting this paragraph.
2. **Generate fresh prod secrets**, distinct from dev: `openssl rand -base64 32` for `AUTH_JWT_SECRET` (api) and again for `AUTH_SECRET` (web), plus a strong `POSTGRES_PASSWORD`.
3. **Enter the `SMTP_*` values.** Uncomment all four lines together and fill them in one edit. Do NOT leave them uncommented-but-blank: measured, that state passes the boot gate silently and binds a real SMTP sender with empty credentials, whereas leaving them commented out makes the API refuse to start — which is the failure you want (revised C2).
   3b. **Reuse the dev Google OAuth client** (revised decision — a separate prod client is not required by anything). In Google Cloud Console add the prod callback to that client's authorised redirect URIs:
   `https://chatofy.quanganh208.dev/api/auth/callback/google`
   Google matches redirect URIs exactly and Auth.js does not override `basePath`, so without it sign-in fails with `redirect_uri_mismatch`. The same `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` then work for prod, and the **same client id** must also sit in the api's `GOOGLE_CLIENT_IDS` or the API rejects the id_token's audience. That variable is a comma-separated allowlist, so a dedicated prod client can be added later without removing this one.
   - **Do this before Phase 1's web image is built if at all possible.** `googleConfigured` is evaluated at module load in `apps/web/src/config/server-env.ts`; if `/login` is statically prerendered, turning Google on afterwards needs a **rebuild**, not a restart.
4. **Decide and populate the model directory.** If copying to a neutral path, copy from the dev tree and verify sizes match (`du -sh`) — a partial copy makes the sidecar fail its healthcheck only after a long start period.
5. **Write `~/.config/chatofy/prod.env`**, `chmod 600`.
6. **Write and commit `prod.env.example`** with every key present and values blank or clearly placeholder, plus a comment for each forced value above.
7. **Create `~/chatofy-backups/`.**
8. **Re-run the Phase 1 stack against the real env file** rather than the temporary one, and confirm the api boots — this is the first time the C2 production gate is actually exercised.

## Success Criteria

- [x] `docker compose -f docker-compose.prod.yml --env-file ~/.config/chatofy/prod.env up -d --wait` all healthy with `NODE_ENV=production`
- [x] api boots AND a real verification mail actually arrives — booting alone proves nothing, now that empty credentials are known to pass the gate
- [x] `stat -c %a ~/.config/chatofy/prod.env` → `600`
- [x] `git check-ignore -v prod.env.example` → not ignored; `git status` shows it stageable
- [x] `git status` shows **no** real env file as untracked-and-stageable (specifically: no `prod.env` in the tree)
- [x] Prod `AUTH_JWT_SECRET` ≠ dev value
- [x] Sidecars pass health with models found at the absolute path
- [x] `~/chatofy-backups/` exists
- [x] The prod callback `https://chatofy.quanganh208.dev/api/auth/callback/google` is registered on the reused dev OAuth client, and that client id appears in **both** the web env and the api's `GOOGLE_CLIENT_IDS`
- [x] The four `SMTP_*` lines are either all filled or all COMMENTED OUT — never uncommented-and-blank (verify by line prefix, not by a match count)

## Risk Assessment

- **`SMTP_*` gate behaves opposite to the obvious reading.** Absent ⇒ refuses to boot (loud, safe). Present-but-empty ⇒ boots clean, no warning, real SMTP sender holding blank credentials, every mail failing at Gmail; the first person to notice is a user whose verification link never arrived. Signal: registration succeeds but no mail arrives. Response: keep the four lines commented until filled. Do **not** work around any failure by dropping `NODE_ENV` to `development` — that also flips the web CSP onto its `unsafe-eval` dev branch.
- **OAuth ordering.** Signal: Google button absent in prod despite credentials being set. Response: rebuild the web image — `googleConfigured` is fixed at build for a prerendered `/login`. Cheapest avoidance is registering the client before Phase 1's build.
- **Accidentally committing a secret.** Signal: `git status` shows a real env file as stageable. Note the trap is the reverse of intuition — `prod.env` is **not** covered by `.gitignore`, only `.env.*` names are. Response: verified with `git check-ignore` in step 1, before any secret file is written; keep real env files outside the repo entirely. The repo's own rule forbids committing dotenv files.
- **Partial model copy.** Signal: sidecar healthcheck fails after its 600s start period — a slow, confusing failure. Response: verify `du -sh` against the source before starting the stack.
- **Wrong `DATABASE_URL` pointing at the dev database.** Signal: prod migrate would mutate dev data. Response: the compose network name and port (5433) differ; check the value explicitly before the first migrate, and note that Phase 5 dumps before migrating anyway.

---

## Outcome (2026-08-24)

Completed. Prod stack boots under `NODE_ENV=production` and **actually delivers mail**.

### Verified

| Check                                       | Result                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| All four `SMTP_*` uncommented and non-empty | confirmed by line prefix, not match count                                                                                |
| api boots, healthy                          | `/health` 200                                                                                                            |
| Real SMTP sender bound, not the fallback    | no `SMTP is not configured` / no-op warning in logs                                                                      |
| **Mail genuinely sent**                     | `[GuardedMailSender] Mail sent (purpose=verify-email, class=attacker-triggerable)`, sent to the SMTP_USER address itself |
| No transport errors                         | no `EAUTH` / `ECONN` / `Invalid login` / dropped                                                                         |
| `WEB_BASE_URL` in-container                 | `https://chatofy.quanganh208.dev`                                                                                        |
| Migrations on fresh prod volume             | both applied                                                                                                             |
| Sidecars on the NEW absolute paths          | healthy; `/healthz` 200 on 8012 and 8013                                                                                 |
| Model mount is read-only                    | `/home/quanganh208/chatofy/models/stt rw=false`                                                                          |
| OAuth id consistent web ↔ api               | same client id both sides                                                                                                |
| prod.env perms                              | 600, outside the repo                                                                                                    |
| `prod.env.example`                          | committable, zero real values                                                                                            |

`User` table count after registering is **0** — correct, not a failure. Registration
creates no account until the mailbox is proven.

### Corrections made during this phase

1. **C2 was wrong as originally recorded** and is now fixed everywhere. The gate
   fires on ABSENCE, not emptiness. Present-but-empty boots clean with a real SMTP
   sender holding blank credentials — worse than missing, because nothing warns.
2. **The OAuth "new prod client" decision was reversed.** Nothing requires it: one
   Google client holds several redirect URIs and `GOOGLE_CLIENT_IDS` is an
   allowlist. Only the redirect URI is mandatory —
   `https://chatofy.quanganh208.dev/api/auth/callback/google`. Accepted trade-off:
   a leaked dev client secret is also a leaked prod one.
3. **A verification method failed here.** Commenting the SMTP block was checked
   with `grep -c '^# SMTP_'`, which returned the expected count while the lines
   were later found uncommented. A match count does not distinguish "these lines
   are commented" from "some lines contain this string". Line-prefix inspection
   plus an actual boot attempt is the check that holds.

### Known, expected

The mailed verification link points at `https://chatofy.quanganh208.dev`, which is
not reachable until Phase 3 publishes the tunnel hostnames. Mail delivery is
proven; following the link is not yet possible.
