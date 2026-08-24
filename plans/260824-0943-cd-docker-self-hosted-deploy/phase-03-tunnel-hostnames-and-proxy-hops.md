---
phase: 3
title: 'Tunnel hostnames and proxy hops'
status: pending
priority: P1
effort: '2-3h'
dependencies: [2]
---

# Phase 3: Tunnel hostnames and proxy hops

## Overview

Publish the locally-running prod stack at `chatofy.quanganh208.dev` and
`chatofy-api.quanganh208.dev` through the cloudflared tunnel already on this
machine, then **measure** `TRUST_PROXY_HOPS` rather than guess it. This is the
highest-consequence manual step in the plan: the config being edited carries the
user's only SSH ingress.

## Requirements

**Functional**

- Both hostnames resolve and serve the prod stack over valid TLS.
- `ssh.quanganh208.dev` still works after the change.
- WebSocket upgrade to `wss://chatofy-api.quanganh208.dev/ws/translate` succeeds.
- CORS preflight from the web origin passes.
- `TRUST_PROXY_HOPS` is set to an empirically confirmed value.

**Non-functional**

- CD never touches this configuration (see rationale below).
- The tunnel edit is reversible within seconds.

## Architecture

### Why two sibling hostnames (C10, C4)

Cloudflare Universal SSL issues certificates for the apex plus **one** label
(`*.quanganh208.dev`). `api.chatofy.quanganh208.dev` sits two labels deep and
would present an invalid certificate to every visitor on the free plan. Sibling
naming — `chatofy` and `chatofy-api` — costs nothing and avoids that entirely.

The alternative of one hostname with path routing was rejected on evidence: the
API has **no** `setGlobalPrefix`, so its routes are bare (`/health`, `/auth/*`,
`/translate`, `/ws/translate`). cloudflared ingress matches paths but does **not**
strip prefixes, so `/api/*` routing would require adding a global prefix — a
public-contract change rippling into web, mobile, extension and
`@chatofy/api-client`.

### Why CD must not touch the tunnel (C9)

`/etc/cloudflared/config.yml` is root-owned and currently carries exactly one
ingress rule: `ssh.quanganh208.dev → ssh://localhost:22`. Giving the deploy
workflow sudo write access to that file means a bad automated write plus a
service restart could sever remote access to the machine. The ingress list also
changes only when a hostname is added, which is not per-deploy work.

### Measuring `TRUST_PROXY_HOPS` (C5, R2)

The request chain is browser → Cloudflare edge → cloudflared → app. The CF edge
appends the client IP to `X-Forwarded-For`; cloudflared connects from loopback
and is expected not to append its own. That reasoning gives `1` — but it is
reasoning, not measurement, and the failure it causes is **silent**: with the
wrong value every request appears to come from one address, so the per-IP auth
rate limit becomes a single shared bucket that one attacker exhausts for
everybody.

`CF-Connecting-IP` is ground truth for the real client address. Compare it
against what Express resolves as `req.ip` and set the hop count so they agree.

Measure here, with the stack running locally and reachable through the tunnel,
**before** any automation exists — this is the last phase where a wrong value is
cheap to notice and fix.

## Related Code Files

- Modify (host, root, one-time): `/etc/cloudflared/config.yml`
- Modify (host, uncommitted): `~/.config/chatofy/prod.env` — final `TRUST_PROXY_HOPS`
- Reference only: `apps/api/src/main.ts:61-62`, `apps/api/.env.example`

## Implementation Steps

1. **Back up the tunnel config** to a timestamped copy before touching it, and keep a second terminal open on the machine. Tailscale is running independently and is a fallback path onto the box if SSH ingress breaks.
2. **Create the DNS routes** for both hostnames against the existing tunnel (`cloudflared tunnel route dns …`). This writes CNAMEs in Cloudflare; it does not touch the local config.
3. **Add both ingress rules** to `/etc/cloudflared/config.yml`, `chatofy.quanganh208.dev → http://localhost:4001` and `chatofy-api.quanganh208.dev → http://localhost:4000`, placed **above** the catch-all `http_status:404` and leaving the existing SSH rule intact. Ingress rules are order-sensitive and the catch-all must stay last.
4. **Validate before restarting**: `cloudflared ingress validate`, and `cloudflared ingress rule <url>` for each of the three hostnames to confirm each matches the rule intended — including the SSH one.
5. **Restart the service** and immediately verify `ssh.quanganh208.dev` still connects.
6. **Verify TLS and reachability** for both new hostnames from outside the machine (not just from localhost — that path bypasses the tunnel and the certificate entirely).
7. **Measure the proxy hops.** Request `/health` through `https://chatofy-api.quanganh208.dev` and compare the address Express resolves against the `CF-Connecting-IP` header. Adjust `TRUST_PROXY_HOPS` until they agree, then restart the api container and confirm.
8. **Verify the two cross-origin paths** that only work end-to-end: a CORS preflight from the web origin against the API, and a `wss://` upgrade to `/ws/translate`. Both exercise wiring (`CORS_ORIGIN`, the CSP `connect-src` baked at build) that localhost testing cannot.
9. **Record the final values** in `prod.env.example` comments so the next person does not re-derive them.

## Success Criteria

- [x] `https://chatofy.quanganh208.dev` loads the app over valid TLS, assets included
- [x] `https://chatofy-api.quanganh208.dev/health` → 200 `{"status":"ok",...}`
- [~] `ssh.quanganh208.dev` — PARTIAL. Ingress rule intact, sshd listening, Cloudflare Access challenge engaged (a broken rule would give the catch-all 404 instead). A full session was NOT completed: Access needs interactive browser auth. Operator to confirm.
- [x] CSP header names the prod API origin — verified from the response header, `connect-src 'self' https://chatofy-api.quanganh208.dev wss://chatofy-api.quanganh208.dev`. NOT verified in a real browser console; the header is the mechanism, so this is strong but not identical evidence.
- [x] CORS preflight from the web origin returns the exact origin, not `*`
- [x] `wss://chatofy-api.quanganh208.dev/ws/translate` reachable — 401 at the upgrade over HTTP/1.1, which is the gateway's auth refusal. An AUTHENTICATED socket carrying audio was not exercised.
- [x] Hop count measured at the origin: one `X-Forwarded-For` entry equal to `CF-Connecting-IP`, socket peer 127.0.0.1 ⇒ 1 hop. Express's resolved `req.ip` was inferred from those headers, not read out of the app directly.
- [ ] Login end-to-end from a browser on another machine — NOT DONE. Needs a human with a browser.

## Risk Assessment

- **R3 — severing SSH ingress.** Signal: `ssh.quanganh208.dev` stops connecting after restart. Response: restore the timestamped backup and restart. Mitigations, in order: back up first, `ingress validate` before restart, keep a local terminal open, Tailscale as an independent path. This risk is why CD never touches this file.
- **R2 — wrong hop count.** Signal: `req.ip` is a fixed address for every request. Response: step 7 measures rather than assumes; do not close this phase on the reasoned value alone.
- **CSP baked against the wrong origin (C3).** Signal: the page loads but every API call and the socket are blocked by the browser, which reads as an outage rather than a config error. Response: this is a **rebuild**, not a restart — `NEXT_PUBLIC_API_BASE_URL` is inlined at build time and also generates `connect-src`. Catching it here is exactly why the browser check is in this phase.
- **Cloudflare plan — resolved: free.** So C10 is binding rather than precautionary: `api.chatofy.quanganh208.dev` genuinely would have presented an invalid certificate. The sibling name is required, and no fallback is needed.
- **Mailed links.** `WEB_BASE_URL` set in Phase 2 is what verification and reset emails are built from. Worth sending one real verification mail here, since a wrong value produces a plausible-looking broken link rather than an obvious failure.

---

## Outcome (2026-08-24)

Completed. Both hostnames live over public TLS, `TRUST_PROXY_HOPS` measured
rather than assumed, SSH ingress preserved.

### Verified

| Check                                        | Result                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| DNS routes created                           | both CNAMEs added to tunnel `faf441dd`                                                                                    |
| `tunnel ingress validate`                    | OK, before restart                                                                                                        |
| Rule order                                   | #0 ssh → :22, #1 chatofy → :4001, #2 chatofy-api → :4000, #3 catch-all 404                                                |
| cloudflared after restart                    | active, 4 connections registered, 0 restarts                                                                              |
| `https://chatofy-api.quanganh208.dev/health` | 200 `{"status":"ok"}`                                                                                                     |
| `https://chatofy.quanganh208.dev/login`      | 200, full HTML                                                                                                            |
| Certificate                                  | Google Trust Services, `CN=quanganh208.dev` — the single-label wildcard, confirming why the sibling hostname was required |
| CORS preflight                               | `allow-origin: https://chatofy.quanganh208.dev` (exact host), `allow-credentials: true`                                   |
| WebSocket upgrade                            | **401** through the tunnel over HTTP/1.1 — the gateway's upgrade-time auth refusal, i.e. the path is reachable            |
| SSH ingress                                  | rule intact, sshd listening, Cloudflare Access challenge still engaged                                                    |

### `TRUST_PROXY_HOPS` — measured

Captured the raw headers cloudflared delivers by briefly swapping what listens on
4000 (no tunnel config change):

```
PEER=127.0.0.1
X-Forwarded-For: <client-ip>      (exactly ONE entry)
Cf-Connecting-Ip: <same client-ip>
X-Forwarded-Proto: https
```

One XFF entry plus a loopback socket peer ⇒ **1 hop**. The provisional value was
right, but it is now evidence rather than reasoning — which matters because C5's
failure mode is silent.

### Caught here: the C3 failure, live

The first public page load returned 200 with a CSP reading
`connect-src 'self' http://localhost:4000 ws://localhost:4000`. The running web
image had been built in Phase 1 with the smoke build arg. The page rendered
perfectly while the browser would have blocked every API call and every socket —
exactly the "looks like an outage, is a config error" mode C3 describes, and not
something a localhost check could ever surface. Fixed by REBUILDING (not
restarting) with the prod arg; CSP now reads
`https://chatofy-api.quanganh208.dev wss://chatofy-api.quanganh208.dev`,
confirming the `^http` → `ws` rewrite produces `wss://` correctly.

**Operational consequence for Phase 5:** the deploy workflow must `build` the web
image with `NEXT_PUBLIC_API_BASE_URL` from prod.env on every deploy, and the
tunnel smoke step must assert the CSP names the prod API origin. A 200 on the
page is not sufficient evidence.

### Two probe results that looked like failures and were not

- `HTTP=000` on the first web request: transient, during tunnel reconnect. Retry succeeded.
- `HTTP=404` on the WebSocket probe: curl negotiated HTTP/2, where `Connection: Upgrade` is meaningless, so it fell through to Express which has no route there. Forcing HTTP/1.1 gives the correct 401.

### Not fully proven

An end-to-end SSH _session_ was not completed — `ssh.quanganh208.dev` sits behind
Cloudflare Access, which needs interactive browser auth. Routing and the Access
challenge both engaged, and a broken ingress would have produced the catch-all
404 instead. The operator should still confirm SSH independently.
