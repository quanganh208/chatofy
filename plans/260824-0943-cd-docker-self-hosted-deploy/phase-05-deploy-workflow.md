---
phase: 5
title: 'Deploy workflow'
status: pending
priority: P1
effort: '3-4h'
dependencies: [4]
---

# Phase 5: Deploy workflow

## Overview

The automation itself: `.github/workflows/deploy.yml`, gated on CI success,
serialized, backing up the database before every migration, and aborting before
it touches running containers if anything fails. **This phase merges last** — see
the ordering trap below.

## Requirements

**Functional**

- Deploy runs only after CI concludes successfully on `main`.
- `workflow_dispatch` allows manual deploy and rollback of a chosen ref.
- Every run dumps the prod database before running migrations.
- A failed build or migrate leaves the previously running stack serving.
- The run ends with a smoke check **through the tunnel**, not only on localhost.

**Non-functional**

- Never triggers on `pull_request`.
- Concurrent deploys are serialized, never cancelled mid-flight.
- No secret appears in workflow logs.
- Disk use stays bounded across many deploys.

## Architecture

### Why `workflow_run` and not `on: push` (the correction that matters)

`on: push: branches: [main]` fires the deploy **in parallel with** CI, not after
it. It reads like a gate and is not one — a deploy would routinely start while
tests are still running and could finish before they fail.

The correct trigger is `workflow_run` on the CI workflow with
`types: [completed]` and `branches: [main]`, plus a job-level guard on
`github.event.workflow_run.conclusion == 'success'`. The `completed` type fires
for failures too, so the conclusion check is what actually gates.

`concurrency: {group: deploy, cancel-in-progress: false}` serializes runs.
Cancelling mid-flight is wrong here specifically because a deploy can be between
`pg_dump` and `migrate deploy`.

`workflow_dispatch` stays for manual runs and rollback.

### Why migrate is a separate step, not part of `up` (the other correction)

Two independent reasons:

1. **The backup must land between "image built" and "migrate runs".** The project rule requires a database backup before any schema change. If migrate is a one-shot service inside the `up` dependency graph, there is no point at which to insert the dump.
2. **Failure containment.** Running `docker compose run --rm migrate` as its own step means a failed migration aborts the workflow _before_ `up -d` recreates anything — the old stack keeps serving. Inside the `up` graph, the failure happens with containers already being replaced.

Step order:

```
build → pg_dump → migrate → up -d --wait → smoke (localhost) → smoke (tunnel)
```

This ordering is most of the rollback story for free.

### Rollback

Two distinct failure modes with two distinct answers:

- **Bad image / bad code.** Tag images with the commit SHA; retag the previous good one before switching. Rollback = `workflow_dispatch` on the earlier ref; the layer cache makes the rebuild fast.
- **Bad migration.** `prisma migrate deploy` is forward-only — redeploying older code does **not** undo a migration. The answer is `pg_restore` from the dump taken immediately before it. This is why the dump is mandatory rather than nice-to-have.

**`workflow_dispatch` on an older ref is not a universal undo.** It rolls back
_code_, never _schema_, so the old code then runs against the newer schema. That
is fine when migrations are additive and fatal when they are not. Whenever a
migration is destructive, `pg_restore` is the **only** rollback.

Blue/green is explicitly out of scope; brief downtime during `up -d` recreate is accepted.

### Not force-recreating

The sidecars load ~1.7GB of models eagerly and take minutes to become healthy.
Compose only recreates services whose image or config actually changed, so a
routine api/web deploy leaves them running. **Never pass `--force-recreate`** —
it would turn every deploy into a multi-minute outage of the speech pipeline for
no benefit.

### Disk growth

Unbounded by default across three axes: images (one per deploy), build cache,
and backups. Each needs an explicit prune, or a 180GB disk fills quietly over
months.

**`docker image prune -f` does not solve the image axis.** It removes only
_dangling_ images, and an image tagged with a commit SHA is by definition never
dangling — so one api+web pair accumulates per deploy, forever. And `prune -a`
is **not** the fix: the daemon is shared with the dev stack and would reclaim
images the dev stack still needs. The fix is targeted: explicitly `docker rmi`
prod-repo SHA tags beyond a retention count, or dual-tag `latest` + `sha` and
untag past retention.

## Related Code Files

- Create: `.github/workflows/deploy.yml`
- Reference only, do not modify: `.github/workflows/ci.yml` (its `name:` is what `workflow_run` keys on — if the name changes, the trigger silently stops matching)

## Implementation Steps

1. **Write `deploy.yml`** with `on: workflow_run` (workflows: `["CI"]`, types `[completed]`, branches `[main]`) + `workflow_dispatch` with a ref input. Add the `conclusion == 'success'` job guard and the `concurrency` block. `runs-on: [self-hosted, chatofy]`. Set `permissions: contents: read`.
2. **Checkout the correct SHA.** Under `workflow_run` the default checkout is not necessarily the commit CI validated — check out `github.event.workflow_run.head_sha` explicitly. This is a common and silent source of deploying the wrong code.
3. **Build** with the prod compose file, tagging images with the commit SHA, retaining the previous tag as the rollback target.
   - **Every compose invocation in this workflow — build, run, up, exec — must pass `--env-file ${HOME}/.config/chatofy/prod.env`.** The prod compose file interpolates `${STT_MODELS_DIR}`, `${TTS_MODELS_DIR}` and the postgres credentials; without the flag those expand to empty and the bind mounts silently point at the wrong place — exactly the failure the absolute-path decision exists to prevent.
4. **Dump the database** — `docker compose exec -T postgres pg_dump -Fc` into `~/chatofy-backups/` named with the SHA and timestamp. Fail the job if the dump fails, **and assert the file is non-empty**; a 0-byte dump is worse than none because it invites trusting it. A deploy that cannot back up must not migrate.
5. **Run migrations** as `docker compose --profile migrate run --rm migrate`. Non-zero exit aborts the workflow here, before `up`.
6. **`up -d --wait`** to roll the changed services.
7. **Smoke on localhost**: `/health` on 4000 and a page load on 4001.
8. **Smoke through the tunnel**: `https://chatofy-api.quanganh208.dev/health` and `https://chatofy.quanganh208.dev`. This is the check that catches certificate, ingress, CORS and CSP problems that a localhost check structurally cannot see.
9. **Prune**, all three axes: targeted `docker rmi` of prod SHA tags beyond retention (**not** `image prune -f`, which never touches tagged images, and **not** `prune -a`, which would raid the dev stack's images off the shared daemon); a bounded `docker builder prune --keep-storage`; and trim `~/chatofy-backups/` to **14** dumps.
10. **Verify no secret is echoed.** The workflow reads the host env file directly via compose `env_file`; it must never `cat` it or pass values through `--build-arg` into logs.
11. **Merge last, then watch the first real run.** The first `workflow_run` fires on the next CI green after merge.

## Success Criteria

- [ ] Push to `main` → CI green → deploy runs automatically, no human step
- [ ] A deliberately failed CI run does **not** trigger a deploy
- [ ] A dump file appears in `~/chatofy-backups/` before migrations on every run
- [ ] Simulated migrate failure aborts the run with the previous stack still answering `/health`
- [ ] Tunnel smoke passes for both hostnames
- [ ] `workflow_dispatch` on an older ref redeploys that version
- [ ] Two rapid pushes queue rather than run concurrently or cancel each other
- [ ] Sidecars are **not** recreated by a deploy that only changed api or web
- [ ] `deploy.yml` contains no command that reads the prod env file into stdout, and passes no secret via `--build-arg` (structural check — "no secret in the log" is not verifiable by reading the log alone)
- [ ] After N+1 deploys, prod SHA-tagged images number ≤ retention, and dev-stack images are untouched

## Risk Assessment

- **Deploying the wrong commit.** Signal: prod runs code that differs from the CI-validated SHA — easy to miss because everything looks green. Response: step 2 checks out `head_sha` explicitly. Verify once by comparing the deployed commit against the CI run.
- **CI workflow renamed.** The `workflow_run` trigger matches on the literal workflow **name** (`CI`). Signal: pushes stop deploying, with no error — the trigger simply never fires. Response: note the coupling in a comment inside `deploy.yml`; it is invisible otherwise.
- **R7 — forward-only migrations.** Signal: a migration corrupts data and redeploying old code does not help. Response: `pg_restore` from the pre-migrate dump. This is the documented procedure, not an improvised one.
- **R6 — slow first build.** Signal: run #1 takes many minutes. Response: expected (cold layer and pnpm store cache); do not treat as failure or "optimise" it away.
- **Disk growth.** Signal: free space falling steadily over weeks. Response: step 9 prunes all three axes; retention is an explicit number, not an implicit "keep everything".
- **Backup step masking failure.** A `pg_dump` that silently produces a 0-byte file is worse than none, because it invites trusting it. Response: assert the dump is non-empty before proceeding to migrate.

---

## Outcome (2026-08-24) — WRITTEN, NOT MERGED

`.github/workflows/deploy.yml` exists in the working tree and is uncommitted by
design: this file must land on `main` last.

### Verified statically

| Check                                               | Result                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| YAML parses                                         | OK, 11 steps                                                                  |
| Triggers                                            | `workflow_run` + `workflow_dispatch` only                                     |
| `pull_request`                                      | absent as a trigger (one occurrence, in a comment explaining why)             |
| `workflows: [CI]` matches the real workflow `name:` | confirmed — `ci.yml` declares `name: CI`                                      |
| `runs-on`                                           | `[self-hosted, linux, chatofy]` — the custom label, not bare `self-hosted`    |
| Image names in the tag/prune steps                  | match what compose actually produces (`chatofy_prod-api`, `chatofy_prod-web`) |
| `concurrency`                                       | `deploy-prod`, `cancel-in-progress: false`                                    |

### Added beyond the original plan, from the Phase 3 incident

The tunnel smoke step **asserts the CSP names the prod API origin** and fails the
deploy otherwise. Phase 3 produced a live 200 page whose policy still named
localhost, which would have blocked every API call and socket in a real browser
while looking perfectly healthy. A 200 on the page is not sufficient evidence,
so the workflow now checks the header rather than the status code alone.

### Not yet exercised

Nothing in this file has RUN. Every claim above is static. The first real
execution happens on the first CI green after it merges, and these remain
unproven until then: the backup step against the live database, the
non-empty-dump assertion, migrate-failure containment, the prune arithmetic, and
`head_sha` checkout correctness.

### Deliberate deviation to flag

`IMAGE_RETENTION` is set to 5. The plan settled 14 for database backups but never
specified an image count; 5 was chosen because each api+web pair is ~1.2GB. It is
a guess, not a decision — change it if you disagree.
