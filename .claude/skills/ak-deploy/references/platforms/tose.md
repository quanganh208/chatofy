# TOSE.sh

## Check the installed CLI first

Install a missing CLI with `npm install -g @tosesh/tose`. Run `tose --version`,
then `tose capabilities --json`. The published npm
package can lag the CLI source, so the installed version decides the path:

- **JSON contract path:** `capabilities` exists. Read the commands, flags, risk
  levels and exit codes from its output instead of from this file.
- **Fallback path:** `capabilities` is missing (for example `@tosesh/tose`
  0.1.2). There is no plan, wait, doctor or pricing command, no JSON envelope,
  and every failure exits `1`. Use `tose <command> --help` to confirm a flag
  before passing it.

## Detection and target

- `.tose.json` in the project directory is a TOSE CLI **project binding**,
  `{ "workspace": "<slug>", "project": "<slug>" }`, written by `tose init` and
  `tose up`. It selects a TOSE project; it is not a deployment spec and holds no
  build, resource or health configuration. `tose.yaml` and `tose.json` (without
  the dot) are not read by the CLI.
- The CLI picks the target from, in order: the `<workspace>/<project>`
  argument, `--workspace`/`--project`, the `TOSE_WORKSPACE`/`TOSE_PROJECT`
  environment variables, `.tose.json`, then the global active project that
  `tose use` stores in the user's CLI config. So environment variables override
  the binding, and a directory with no binding can still deploy an unrelated
  globally active project.
- Before any mutation, name the target explicitly as `tose deploy
  <workspace>/<project>`, check whether `TOSE_WORKSPACE` or `TOSE_PROJECT` is
  set, and confirm a target that came only from the global active project.
- A provider-neutral AgentKit deployment spec is a separate file owned by the
  `ak deploy` engine. Do not treat `.tose.json` as one, and do not copy TOSE
  workspace or project IDs into a portable spec.

## What gets deployed

TOSE builds the head of the project's connected git branch, not the local
working tree. Before deploying, confirm local changes are committed and pushed
to that branch; after deploying, compare the deployment's commit with the
pushed head and report a mismatch.

## Deploy and verify

JSON contract path:

1. `tose deploy <ws>/<project> --dry-run --json` is read-only. A blocker exits
   non-zero with `PREFLIGHT_FAILED` and the plan in `error.details.plan`; report
   the blockers and the plan's `not_checked` items.
2. After approval, `tose deploy <ws>/<project> --wait --json`. Re-running while
   a build is in progress attaches to it (`"reused": true`); do not pass `--new`
   unless the user asked for a second deployment.
3. If the wait times out or is interrupted, resume with the
   `tose deployment wait <id>` command from `next_actions`; never redeploy.

Fallback path: `tose deploy <ws>/<project> --json`, then poll
`tose status <ws>/<project> --json` until the latest deployment and pods settle.

Map the result to the skill's states:

- An envelope `status: "pending"`, a deployment object whose own `status` is
  `queued` or `building`, or exit `0` from a deploy without `--wait` is
  `queued`/`running`, never `healthy`.
- `--wait` success or ready pods mean `unverified`: pod readiness is not app
  health. Mark `healthy` only after the URL or health endpoint responds.
- A failed build, or a deployment the server cancelled or rolled back, is
  `failed`. A timeout is still `running`; it may finish.
- Report `error.code` and `error.request_id` when present.

`tose up` prompts interactively regardless of `--json`, can create a project,
and pushes `.env`. Do not run it from agents or CI; ask the user to run it for
first-time setup. `tose doctor --json` (contract path) diagnoses a project that
does not deploy or serve.

## Credentials and environment variables

- Pass the API key through `TOSE_API_KEY` or `tose login --api-key-stdin` where
  supported, never `--api-key <key>` on the command line.
- `tose env list` prints values, including in JSON. Read only the key names
  from it and never print the values.
- Set secrets with `tose env push <file>` from a file the user controls, not
  `tose env set KEY=VALUE`, which puts the value in argv and shell history.
  Treat `tose env pull` output as a secret file.

## Pricing

Do not quote TOSE prices, credits or discounts from this file or from memory.
On the contract path read them live with `tose pricing --json` (public, no API
key) or the cost range in the dry-run plan, and state the source and its
assumptions; the compute tier depends on the wallet balance, so present a range.
On the fallback path there is no live price source in the CLI: say the cost is
unverified rather than estimating it.

## Rollback and stop

The CLI has no rollback command. Roll back from the TOSE dashboard by selecting
a previous deployment, or push a known-good revision to the connected branch and
redeploy, then verify health again. `tose deployment cancel <id> --yes`
(contract path) only stops a deployment that is still building.

`tose down` stops the app. Confirm with the user first: older CLIs skip their
own confirmation under `--json` or without a terminal.

## Fit

Container or server workloads with a `Dockerfile` or a supported server
runtime (Node.js, Python, Go, or SSR frameworks such as Next.js and Nuxt).
Static sites and SPAs fit a static host better. Confirm region, data and runtime
constraints for the specific app before recommending it.
