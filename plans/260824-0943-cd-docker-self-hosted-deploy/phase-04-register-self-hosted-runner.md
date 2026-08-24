---
phase: 4
title: 'Register self hosted runner'
status: pending
priority: P1
effort: '1h'
dependencies: [3]
---

# Phase 4: Register self hosted runner

## Overview

Register this machine as a GitHub Actions self-hosted runner for the repo,
installed as a service so it survives reboot, and labelled so no workflow other
than the deploy lands on it.

## Requirements

**Functional**

- Runner appears online for `quanganh208/chatofy` with a distinctive label.
- Runner starts automatically on boot.
- Runner can invoke `docker` and `docker compose` without an interactive prompt.

**Non-functional**

- Runner lives outside the repo working tree.
- No workflow reaches it except by explicitly requesting its label.

## Architecture

### Labelling is the isolation mechanism

`runs-on: self-hosted` matches **any** self-hosted runner. A custom label
(`[self-hosted, chatofy]`) means only a workflow that explicitly asks for it
lands here — so an unrelated workflow, now or later, cannot execute on this
personal machine by accident.

### The trust boundary, stated plainly (R5)

The runner user is in the `docker` group, which is root-equivalent on this
machine: anything that executes in a job can mount the host filesystem and
escalate. That is acceptable for a personal box deploying its owner's code, and
three facts bound it:

- The repo is **private** (C13), so no outside party can open a PR against it.
- The deploy workflow will never trigger on `pull_request` (Phase 5) — fork-PR code execution is the classic self-hosted runner compromise.
- The custom label keeps unrelated workflows off it.

This is a deliberate accepted risk, not an oversight. It should not be
re-litigated later without new evidence, but it also should not be forgotten:
if the repo is ever made public, the `pull_request` rule becomes load-bearing
rather than belt-and-braces.

### Ordering

Registering the runner before Phase 1 would have been harmless but pointless —
there would be nothing correct for it to run. Registering it _after_ the images
and tunnel are proven, and _before_ `deploy.yml` exists, is the only ordering
where the first real deploy has a working target and no queued-into-the-void runs.

## Related Code Files

- Create (host, outside the repo): `~/actions-runner/`
- No repository files change in this phase.

## Implementation Steps

1. **Obtain a registration token** for `quanganh208/chatofy` (repo settings, or via `gh api`). Registration tokens are short-lived.
2. **Install the runner** into `~/actions-runner/` — deliberately outside the project tree so a repo operation can never disturb it.
3. **Configure it** against the repo with the label set `self-hosted,linux,chatofy` and a recognisable runner name.
4. **Install as a service** (`./svc.sh install` then `./svc.sh start`) so it survives reboot. A runner started in a terminal dies with the terminal, which produces deploys that mysteriously never run.
5. **Confirm docker access** as the runner user: `docker ps` and `docker compose version` must work with no sudo prompt. If not, add the user to the `docker` group and re-login.
6. **Verify it is online** and correctly labelled via `gh api repos/quanganh208/chatofy/actions/runners`. This currently returns 0 runners, so the delta is unambiguous.
7. **Reboot test** — or at minimum `systemctl restart` the runner service — and confirm it comes back online by itself.

## Success Criteria

- [x] `gh api repos/quanganh208/chatofy/actions/runners` shows exactly one runner, status `online`
- [x] Its labels include `chatofy`
- [x] Service `enabled` + `active`, verified `online` again after `systemctl restart`. A full REBOOT was not performed.
- [x] `docker ps` succeeds with no sudo, including from a clean `env -i` shell. NOTE: this works via Docker Desktop's per-user socket, not `/var/run/docker.sock`, which does not exist here — see the reboot gap below.
- [x] The runner's work directory is outside the project tree
- [x] No workflow currently in the repo targets this label (nothing runs on it yet)

## Risk Assessment

- **R5 — runner user is root-equivalent via docker.** Accepted, bounded by private repo + no `pull_request` + custom label. Signal that the bound weakened: the repo becoming public, or a workflow gaining a `pull_request` trigger that targets this label. Response: if the repo is ever made public, re-review before the next deploy.
- **Runner started interactively instead of as a service.** Signal: deploys stop happening after a reboot, with no error anywhere — the run simply queues. Response: step 4 uses `svc.sh install`; step 7 verifies it explicitly.
- **Registration token expiry.** Signal: `config.sh` rejects the token. Response: tokens are short-lived by design; fetch a fresh one.
- **Runner picks up an unrelated workflow.** Signal: an unexpected job appears in its log. Response: the custom label prevents this; if it happens, a workflow is using bare `self-hosted` and must be corrected.

---

## Outcome (2026-08-24) — COMPLETE, with one gap found

| Step                                                       | State                                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Runner downloaded to `~/actions-runner` (outside the repo) | done, v2.336.0                                                                          |
| Configured against `quanganh208/chatofy`                   | done                                                                                    |
| Labels                                                     | `self-hosted, Linux, X64, chatofy` — the custom `chatofy` label present                 |
| Registered                                                 | confirmed via `gh api`, name `chatofy-local`                                            |
| Status                                                     | **online**, `busy=false`                                                                |
| Installed as a service                                     | done — `actions.runner.quanganh208-chatofy.chatofy-local.service`, `enabled` + `active` |
| Docker access from a CLEAN environment                     | ok — `docker ps` and `compose v5.3.1` both resolve                                      |
| Service restart survival                                   | verified — came back `online` on its own                                                |

### The trust boundary is NOT what this phase assumed

R5 was written as "the runner user is in the `docker` group, which is
root-equivalent". Measured: the user is **not** in the `docker` group, and
`/var/run/docker.sock` **does not exist on this machine at all**. Docker here is
Docker Desktop, context `desktop-linux`, over a per-user socket at
`~/.docker/desktop/docker.sock`.

That is a _narrower_ boundary than the plan assumed, not a wider one, so the
accepted risk stands and is if anything smaller. But the stated reason for it was
wrong and would have misled anyone re-reviewing it later.

### GAP FOUND: the prod stack does not survive a reboot unattended

Discovered while verifying this phase, and it is not a runner problem:

- The runner is a **system** service — starts at boot, no login needed.
- Docker Desktop is a **user** service, and `Linger=no` for this user.

A user service without linger starts on **login**, not on boot. So after a
reboot with nobody logged in: the runner comes up, Docker Desktop does not, and
every `docker` call in a deploy fails. The prod containers' `restart:
unless-stopped` cannot help either — that is honoured by a daemon that is not
running.

This invalidates the plan's success criterion _"all prod services healthy after a
host reboot"_ as written. Options, none applied yet because it is the operator's
call:

1. `sudo loginctl enable-linger quanganh208` — user services start at boot; Docker Desktop and therefore the prod stack come back unattended.
2. Move to the system Docker Engine (`/var/run/docker.sock`) instead of Docker Desktop.
3. Accept it: log in after any reboot. Reasonable on a desktop that is logged into anyway, but it must be a decision rather than a surprise.

### Ordering constraint

The runner must be **online before `deploy.yml` reaches `main`**. With
`workflow_run` the workflow arms on the very next CI green, and CI runs on the
push that carries it — so a merge with an offline runner queues a deploy into
nothing.
