---
phase: 6
title: 'Provisioning and docs'
status: completed
priority: P1
effort: '4h'
dependencies: [5]
---

# Phase 6: Provisioning and docs

## Overview

Create the R2 bucket and its credentials, wire the build arg the CSP depends on, add
the deploy-time check that catches a wrong origin, and record all of it in the docs
that own deployment and architecture.

## Requirements

- Functional: a documented sequence taking an operator from no bucket to a working
  avatar in production.
- Non-functional: a build that would ship a CSP without the avatar origin is caught by
  a check, not by a user; a missing variable never blocks an unrelated deploy; no
  credential is committed.

## Architecture

**The build arg gets a default, NOT `:?`.** An earlier draft made it required, copying
`NEXT_PUBLIC_API_BASE_URL`. That is wrong here and the reason is specific to this
pipeline: `deploy.yml:113-114` runs `docker compose ... config --profiles` as the
**first** compose call, before any image builds, before the database backup, before
`migrate`. Compose expands every interpolation at config time, so one unset `:?`
variable aborts the entire run — `api`, `migrate`, the seed jobs, `web`. `prod.env`
lives on the runner's filesystem and is hand-edited; it is not committed and CI cannot
seed it. So merging a `:?` for an avatar origin means that deleting the bucket, retiring
the domain, or dropping a line from `prod.env` blocks every deploy including an
unrelated security hotfix, until someone SSHes to the host.

That also contradicts the plan's own Goal 6 — R2 unconfigured is supposed to degrade,
not stop anything. A default plus a positive check is what actually wants to be here.

**The check that matters asserts the served header, not the build's exit code.**
`deploy.yml:223` already greps the tunnel's response for `connect-src`, and
`deployment-guide.md` records that this assertion exists because of a real incident
where a stale web image shipped. `img-src` gets the same treatment. This catches the
whole class the `:?` guard could not: a missing Dockerfile `ARG`, a typo'd domain, or a
web image that was not rebuilt.

**`apps/web/Dockerfile` is a required edit, not a confirmation.** It declares
`ARG NEXT_PUBLIC_API_BASE_URL` / `ARG NEXT_PUBLIC_ENV` and promotes each to `ENV`; there
is no avatar ARG. A build arg passed by compose but not declared in the Dockerfile is
**not an error** — BuildKit warns and the value never reaches `next build`. The build
goes green, `img-src` omits the origin, and every avatar in production is blocked.

**Two variables hold one origin, and they are checked against each other.**
`R2_PUBLIC_BASE_URL` (api, runtime) mints the URLs; `NEXT_PUBLIC_AVATAR_BASE_URL` (web,
build) authorises them. They cannot be merged — they are consumed by different processes
at different times — so the equality is enforced instead of assumed. Without that, the
very operation the key-not-URL design was chosen to make cheap (moving the origin) is
the one that silently breaks: update the API's variable, restart, and the API now mints
URLs the deployed CSP forbids.

**The `api` service needs no compose change.** It already reads
`env_file: ${CHATOFY_ENV_FILE}`, so all five `R2_*` variables arrive by editing
`prod.env`. Only `web` is edited, because its value is a build arg.

## Related Code Files

- Modify: `apps/web/Dockerfile` (**required** — add the `ARG` + `ENV` pair)
- Modify: `docker-compose.prod.yml` (web build args)
- Modify: `.github/workflows/deploy.yml` (extend the CSP smoke to `img-src`)
- Modify: `prod.env.example`
- Modify: `apps/api/.env.example`
- Modify: `docs/deployment-guide.md`
- Modify: `docs/system-architecture.md`

## Implementation Steps

1. **Operator runbook** — performed once, then recorded in `docs/deployment-guide.md`:
   1. Cloudflare → R2 → create bucket `chatofy-avatars`.
   2. Bucket → Settings → Public access → connect a custom domain (e.g.
      `cdn.chatofy.<tld>`). Wait for the DNS record to go active, then verify with
      `curl -I https://<domain>/` **before** wiring anything else — a bucket that is not
      actually public produces the same browser symptom as a missing CSP entry, and
      separating the two failures in time is the point of doing this first.
   3. R2 → Manage API Tokens → a token with **Object Read & Write scoped to this bucket
      only**. The API never reads objects back (the browser fetches them from the public
      domain), so nothing here justifies an account-wide key.
   4. Add all five `R2_*` values and `NEXT_PUBLIC_AVATAR_BASE_URL=https://<domain>` to
      `prod.env` on the runner. **Do this before merging step 2's compose change.**
   5. Rebuild the web image — the origin is compiled in; `up -d` alone does not pick it
      up.

   Note for the runbook: compose interpolates `build.args` from the shell environment or
   `--env-file`, never from a service's `env_file:`. Every real deploy passes
   `--env-file` (`deploy.yml:148,165`), so a manual `docker compose build` must too, or
   the variable appears unset for reasons the error message does not explain.

2. `apps/web/Dockerfile`, beside the existing pair:

   ```dockerfile
   ARG NEXT_PUBLIC_AVATAR_BASE_URL=
   ENV NEXT_PUBLIC_AVATAR_BASE_URL=${NEXT_PUBLIC_AVATAR_BASE_URL}
   ```

   Without both lines the compose arg is silently discarded.

3. `docker-compose.prod.yml`, in `web.build.args`:

   ```yaml
   # BUILD-time like NEXT_PUBLIC_API_BASE_URL above: this feeds the CSP's img-src.
   #
   # Defaulted, NOT `:?`. `deploy.yml` runs `compose config` before it builds anything,
   # so a required-and-unset variable aborts the whole pipeline — api, migrate and the
   # seed jobs included — over a profile picture. Unset here means avatars are off and
   # everything else deploys; the img-src smoke below is what catches a WRONG value.
   NEXT_PUBLIC_AVATAR_BASE_URL: ${NEXT_PUBLIC_AVATAR_BASE_URL:-}
   ```

4. `.github/workflows/deploy.yml`: extend the existing tunnel smoke. Grep `img-src` from
   the same response, and when `NEXT_PUBLIC_AVATAR_BASE_URL` is non-empty, fail the
   deploy unless the directive contains its origin. When it is empty, skip the assertion
   and log that avatars are not configured — that is the supported degraded state.

5. `prod.env.example`: the five `R2_*` variables and `NEXT_PUBLIC_AVATAR_BASE_URL`,
   placeholders only, with two notes — all five R2 values are needed together (a partial
   set disables uploads rather than half-working), and `R2_PUBLIC_BASE_URL` and
   `NEXT_PUBLIC_AVATAR_BASE_URL` must name the same origin, with changing either being a
   **web rebuild**, not an API restart.

6. `apps/api/.env.example`: the same five, commented as optional in development, with
   the consequence stated — `PUT /auth/me/avatar` and `DELETE /auth/me/avatar` return
   409 with a message naming the cause; everything else works normally.

7. `docs/deployment-guide.md`: an "Avatar storage (R2)" section near the existing
   Cloudflare Tunnel material, carrying the runbook, the rebuild-not-restart rule for
   **both** origin variables, the `--env-file` note, and the deletion window — avatar
   removal is authoritative at the origin but edge-cached for up to one hour.

8. `docs/system-architecture.md`: where avatar bytes live, why the column holds a key
   rather than a URL, and why `avatarChangedAt` exists. One short subsection; do not
   restate the phase files.

9. Verify end to end against the real bucket: upload from `/account`; confirm the object
   in R2 carries the expected content type and `max-age=3600`; hard-reload and confirm
   the image loads with no CSP violation; remove it and confirm the object is gone from
   the bucket, not merely dereferenced.

## Success Criteria

- [ ] `apps/web/Dockerfile` declares both the `ARG` and the `ENV` — a build without them is caught by the smoke, not shipped
- [ ] An unset `NEXT_PUBLIC_AVATAR_BASE_URL` does **not** abort `docker compose config`; api, migrate and web all still deploy
- [ ] With it set, the deploy smoke asserts the served `img-src` contains that origin and fails the deploy if not
- [ ] With it unset, the smoke skips the assertion and logs that avatars are unconfigured
- [ ] `prod.env.example` and the deployment guide state that the two origin variables must match and that changing either is a web rebuild
- [ ] The `api` service picks up all five `R2_*` values from `prod.env` with no compose change
- [ ] The R2 API token is scoped to the single bucket, not the account
- [ ] `curl -I https://<custom-domain>/<a-known-key>` returns 200 with the expected content type and `max-age=3600`
- [ ] Upload → hard reload in production renders the avatar with no console CSP violation
- [ ] Remove in production deletes the object from the bucket, verified in the R2 console
- [ ] The one-hour edge-cache window for removals is documented
- [ ] No credential, token, or real domain appears in any committed example file
- [ ] A fresh `pnpm install && pnpm dev` works with no R2 configuration at all

## Risk Assessment

**A wrong-but-present origin.** The whole reason the guard moved from `:?` to a served-
header assertion. Signal: the smoke fails the deploy naming the mismatch. Response:
that is the designed behaviour; fix `prod.env` and rebuild web.

**The two origin variables drift.** Signal: the `img-src` smoke fails after an origin
change, or avatars break with a green build if only the API side moved. Response: the
smoke asserts the deployed header against the configured value on every deploy, and the
guide states the rebuild rule. An operator changing only `R2_PUBLIC_BASE_URL` and
restarting the API is the case to watch — it is a restart that appears to work.

**The custom domain is not actually serving publicly.** Signal: `curl` returns 401/403
while the CSP is correct — indistinguishable from a CSP problem in a browser. Response:
step 1.2's curl runs before anything else is wired.

**Docs drift once the bucket is real.** Signal: the guide naming a placeholder domain.
Response: the guide documents the shape and the check command; the domain lives in
`prod.env`, which is not committed.

**A credential pasted into an example file.** Signal: a secret-scan hit in review.
Response: `development-rules.md` forbids it and `ak:git` scans on commit; example files
carry placeholders only.
