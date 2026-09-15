---
title: 'Planning conversation audio recording: what the CSP and the body parsers decided'
date: 2026-09-14
summary: 'Best-of-5 brainstorm then a 6-phase plan; two CSP directives and a global auth guard eliminated every obvious transport, and a content-type gap enabled the one that survived.'
---

# Planning conversation audio recording: what the CSP and the body parsers decided

## What happened

Planned adding conversation audio recording (stored on R2) plus a per-utterance timestamp
gutter to the history detail screen. Ran `ak:brainstorm --ultra` first — five independent
candidates against one immutable evidence packet, scored by a Kongming verifier — then
turned the winning contract into `plans/260914-1036-conversation-audio-recording/`.

The interesting part was how much the existing code had already decided.

**Three obvious transports were dead before any were tried**, and each would have failed
only at runtime in a browser:

- Presigned direct-to-R2 upload: `next.config.ts:85` is `connect-src 'self' ${api} ${socket}`,
  so the browser fetch is CSP-blocked with no server-side error.
- `<audio src>` pointed at R2: `next.config.ts:88` is `media-src 'self' blob:`.
- `<audio src>` pointed at the API: `auth.module.ts:113` makes `JwtAuthGuard` the sole
  global `APP_GUARD` and nothing on the conversations controller is `@Public()`, so a tag
  cannot carry a bearer token.

Fetch-to-blob is therefore not a workaround but the only authenticated read path — and
`blob:` is already admitted, so the feature needs no CSP change at all.

**The enabling fact was an absence.** `main.ts:27` and `narrow-body-limits.ts` register
only `json()` parsers, and there is no multipart middleware in the API. An `audio/webm`
body is read by _nothing_ — `req.body` is `undefined` — so the 1 MB `/conversations`
ceiling provably does not apply to it, and a raw parser can be mounted on the exact param
path without widening anything. Two regression gates pin this: the existing 413 case at
`conversations.db-e2e-spec.ts:247` must keep passing, and a 2 MB `audio/webm` body must
reach the audio route while a 2 MB JSON body still 413s.

**The timestamps turned out to be nearly free.** `TurnCapture { openedAt, closedAt }`
already exists client-side and `display-groups.ts` already trusts `openedAt` to merge
ceiling-split turns — the schema comment even records that these were deliberately not
persisted. Persisting one is a contract change, not a new measurement.

## Decision

The user overrode the contract on storage. The brainstorm required a **separate private
bucket**, and `avatar-image.ts:67-74` says why in the code itself: an R2 prefix "is NOT an
access boundary… anything that must not be world-readable belongs in a different bucket,
not under a different prefix here."

Presented with that and the trade-off, the user chose the shared `chatofy` bucket with a
`conversations/` prefix anyway, to avoid a second bucket and a token re-scope. The
consequence is recorded in the plan rather than softened: every recording is world-readable
by URL, permanently, with no auth and no revocation. Two mitigations are in scope — the key
carries independent entropy like `buildAvatarKey` does, and playback still goes through the
owner-scoped route, which is what keeps a later move to a private bucket a one-line change.

Also decided: recording on by default (so the landing copy, which _is_ this product's only
privacy notice, must be amended in the same PR), retention until delete, web-only,
click-to-seek in scope, and Safari supported — which makes `audio/mp4` a live branch.

## What the multi-candidate pass actually bought

Three constraints my own scouting missed, each found by a different candidate and each
verified before being accepted: the prefix-mount behaviour of `app.use('/conversations')`,
the content-type gating, and the `connect-src` kill. One candidate also "corrected" the
evidence packet by claiming the deploy smoke has no CSP assertion — that was wrong
(`deploy.yml:223-227` and `:244-248`), and saying so mattered as much as accepting the
true findings.

The verifier scored C highest (89) but selected it _conditionally_, naming in advance that
click-to-seek would flip the winner to A. It did.

## Next steps

1. Phase 1 is a standalone browser spike with no repo changes: can a `blob:`-backed WebM be
   seeked? Chromium's `MediaRecorder` writes no Duration, so `audio.duration` may read
   `Infinity` and `currentTime` may be refused. This decides whether the gutter is a button
   or plain text, so it runs before Phase 5 is written.
2. Confirm the existing R2 token writes under a new prefix before Phase 3 deploys.
3. Confirm the `throwOnRequestTimeout` claim — the verifier reported that in
   `@smithy/node-http-handler` 4.11.3 a bare `requestTimeout` only warns. Unverified here
   because the `scout-block` hook blocks `node_modules` reads and I did not work around it.
   If true it is also a latent defect in the existing avatar client, as a separate follow-up.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
