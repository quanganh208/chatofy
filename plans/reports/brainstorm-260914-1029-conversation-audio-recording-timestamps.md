---
type: brainstorm
date: 2026-09-14
branch: main
mode: --ultra (best-of-5 verifier)
status: accepted — ready for planning
---

# Conversation audio recording on R2, with per-utterance timestamps

## Summary

Chatofy will record each `/translate` conversation from the browser, store it in a new
**private** R2 bucket, and play it back on `/history/[conversationId]` beside a timestamp
gutter (`00:01`, `00:06`, `00:12`) where clicking a time seeks the player to that
utterance. The recording is the processed microphone signal the recognizer itself heard,
so it answers the question that motivated the request: was a bad line a bad recognition
or a bad translation?

Both halves are cheaper than they look, for different reasons. The timestamps are not a
new measurement — `TurnCapture.openedAt` already exists client-side and
`display-groups.ts` already trusts it to merge ceiling-split turns; persisting it is a
contract change. The upload needs no presigner, no CSP change and no new npm package,
because a body sent as `audio/webm` is read by **no** parser in the API today.

This was run as a best-of-5 verifier pass. Five independent candidates and a
strongest-model verifier; the winner is materialized below. Ranking appendix at the end.

---

## Outcome

On `/history/[conversationId]` every transcript block carries a timestamp in a left
gutter, outside the existing left rule, with the speaker label, source line and
translation beside it exactly as today. Above the transcript — on the page ground, not in
a card — sits a slim playback bar: an outline play/pause button, a scrub slider, and an
elapsed/total readout. Pressing play fetches the recording from the API as a blob;
clicking any gutter time seeks to that utterance. A conversation recorded before this
ships, or one whose upload failed, shows the transcript with no gutter times and no bar,
and nothing else changes. Deleting a conversation deletes the recording object first,
then the row. The landing copy says the recording is kept, replacing the claim that audio
is never uploaded.

## Constraints

Each verified against source.

1. **The existing `chatofy` bucket cannot hold this.** `avatar-image.ts` states it in the
   key builder: R2 public access is bucket-level and its API tokens scope to a bucket,
   never to a prefix, so anything that must not be world-readable belongs in a different
   bucket. `prod.env.example` names conversation audio as exactly that case. A second,
   private bucket is required — this is not a preference.
2. **Presigned direct-to-R2 upload is impossible from the browser.**
   `apps/web/next.config.ts:85` is `connect-src 'self' ${api} ${socket}`; a fetch to an R2
   origin is CSP-blocked, silently, at runtime.
3. **`<audio src>` cannot point at R2 or at the API.** `next.config.ts:88` is
   `media-src 'self' blob:` with no interpolation hook, and `auth.module.ts:113` makes
   `JwtAuthGuard` the sole global `APP_GUARD` with nothing on the conversations controller
   marked `@Public()` — so a tag cannot carry a bearer token. Fetch-to-blob is the only
   authenticated read path, and `blob:` is already admitted.
4. **Audio must not ride `PUT /conversations/:id`.** `use-conversation-save.ts` re-fires
   the full-replacement write on every post-end transcript edit, coalesced at
   `EDIT_COALESCE_MS = 800`, and `narrow-body-limits.ts` caps the path at 1 MB.
5. **That 1 MB cap is content-type gated, and this is the enabling fact.**
   `narrow-body-limits.ts` and `main.ts:27` register only `json()` parsers, and there is no
   multer/busboy/raw/multipart middleware anywhere in the API. An `audio/webm` body walks
   past both limits — **and is read by nothing at all** until this feature registers a
   parser for it. Both halves matter.
6. **The `/conversations` mount is a prefix**, proven by
   `@Controller('conversations/:conversationId/minutes')` at `minutes.controller.ts:41`.
7. **`TransformInterceptor` wraps every non-`/health` response** in
   `{success, data, meta}` (`transform.interceptor.ts:26-46`). A `StreamableFile` return is
   mapped into the envelope before Nest's `instanceof` check runs, so the binary GET must
   use non-passthrough `@Res()` and write the body itself.
8. **The R2 seam is all-or-nothing and an unconfigured deployment must still boot** —
   `getR2Config` (`storage.module.ts:20-38`) returns `undefined` on any missing key and
   binds the disabled implementation. `DisabledAvatarStorage.delete` **throws**; deletion
   is not best-effort.
9. **Store a key, never a URL** — the `User.avatarKey` precedent.
10. **`/history/[conversationId]` has spent both design budgets exactly.**
    `accent-budget-app.spec.tsx:465-492` pins both detail rows at `filled: 1, surfaces: 2`;
    `KNOWN_VIOLATIONS` is `{}` and enforced in both directions. The two surfaces are the
    transcript `Card` and the minutes `Card`; the one accent is Generate minutes. A player
    card would be a third surface and a filled Play a second accent — both are test
    failures, not style opinions.
11. **A re-save cannot clobber audio columns.** `prisma-conversation.store.ts:105-112` is
    an `upsert` whose `update` is `{direction, startedAt, endedAt}` only; turns are
    `deleteMany` + `createMany`. Parent columns survive a rename re-save for free.
12. **The offset base is not the recording start.** `use-streaming-translate.ts:383`
    stamps `startedAt` _before_ `session.start()` — before the permission prompt, worklet
    load and socket connect. A second number is required, or every timestamp is wrong by
    the same unknown constant.
13. **Server-side audio is gappy by construction.** `capture-pump.ts` discards audio
    outside a turn (idle blocks age out of a 320 ms ring buffer) and half-duplex ignores the
    microphone while our own translation sounds. There is no `ffmpeg` in any Node package.
14. **The privacy copy IS the notice and changes with the behaviour** —
    `en.ts:445-460`, whose own comment records the rule and the precedent. `vi.ts` is
    `satisfies`-typed, so parity is a compile error. `web.landing.localTitle` is **also** a
    nav label (`marketing-header.tsx:59`), so the replacement must stay short.
15. **Only utterance-level timing exists.** The sherpa-onnx sidecars return no token
    timings; `TurnCapture { openedAt, closedAt }` is the measurement, and
    `use-streaming-translate.ts:383` / `turn-pipeline.ts:194,250` are both `Date.now()` in
    the same tab, so the subtraction is clean.
16. **`packages/realtime-client` is shared with the extension**, but the extension calls
    neither `toConversationTurns` nor `saveConversation` — history is already web-only.

## Non-goals

- **Extension and mobile** (user decision). The extension captures third-party tab audio;
  mobile has no audio dependency at all.
- **Word-level timings / karaoke highlight.** Not available from the sidecars, and not
  what the mockup shows.
- **Storage quota or usage metering.** None exists anywhere in the codebase; adding one is
  a separate product decision.
- **Any CSP, `R2_PUBLIC_BASE_URL`, or web-image-rebuild change** — and therefore no third
  case in the deploy smoke's served-header assertions.
- **Resumable / crash-proof upload.** The transcript save already accepts losing a
  conversation to a hard tab close; the recording inherits that same loss profile.
- **Retention policy or auto-expiry** (user decision: retention until delete).
- **Searching or generating minutes from audio.**

## Acceptance criteria

1. `pnpm --filter types test` — `saveConversationTurnSchema` accepts `offsetMs: null` and
   an integer in `[0, MAX_DURATION_MS]`, rejects negative and non-integer.
2. `pnpm --filter realtime-client test` — a block's `offsetMs` equals its **first**
   member's `captures[sessionId].openedAt − startedAtMs`; every piece of a block split by
   `splitAtCap` carries the same `offsetMs`; a block with no capture record yields `null`;
   a capture earlier than `startedAtMs` clamps to `0`.
3. `prisma migrate diff … --exit-code` exits **0** after the new migration — no drift. The
   migration adds only nullable columns (`Conversation.audioKey`,
   `Conversation.audioOffsetMs`, `ConversationTurn.offsetMs`) and no index.
4. `pnpm --filter api test` — a new `conversation-audio.spec.ts` (sniff accepts EBML
   `1A 45 DF A3` and `ftyp` at byte 4; refuses JSON, a `RIFF/WAVE` body, an empty buffer,
   and anything over the cap) and `r2-conversation-audio-storage.spec.ts` mirroring the
   avatar spec.
5. `pnpm --filter api test:e2e` — and **the existing 413 case at
   `conversations.db-e2e-spec.ts:248` still passing unchanged**, which is the regression
   proving the added raw parser did not widen the JSON ceiling. Paired with the inverse: a
   2 MB `audio/webm` body reaches the audio route while a 2 MB JSON body to
   `PUT /conversations/:id` still 413s. New cases: upload returns 204 and sets `audioKey`;
   a foreign id returns 404 identically to an absent one; oversized returns 413 before the
   route runs; non-WebM/MP4 returns 415; storage unconfigured returns 409 with the row
   untouched; the GET streams audio **with no success envelope**; DELETE removes the object
   before the row, and a storage failure leaves both in place with a 409.
6. `pnpm --filter web test` — `accent-budget-app.spec.tsx` passes with `KNOWN_VIOLATIONS`
   still `{}`, its two existing detail rows unchanged, and **two new rows** —
   `'/history/[conversationId] — with a recording'` and `'— the recording failed to load'`
   — both at `filled: 1, surfaces: 2`.
7. `pnpm typecheck` — the i18n parity gate: every new `web.history.*` key and the two
   rewritten `web.landing.local*` values exist in both dictionaries or the build fails.
   Plus a grep criterion: `en.ts` no longer contains "never uploaded" and `vi.ts` no longer
   contains "không bao giờ được tải lên".
8. `pnpm lint`, `pnpm build`, `pnpm knip` green with no new unused export.
9. The deploy smoke at `.github/workflows/deploy.yml:218-250` passes **unmodified** — no
   new origin, so no new case. A diff touching those lines is evidence of drift.
10. **Manual, and named as manual because no gate can see it** (happy-dom has no box
    model and no `MediaRecorder`): on Chromium, Firefox **and Safari**, record a ≥2-minute
    conversation with at least four utterances, open the detail screen, press play, and
    confirm each gutter time seeks to the start of that utterance within ±1 s.

## Recommendation

**A client `MediaRecorder` tap on the session's own `MediaStream`, uploaded one-shot to
the API after the transcript save lands, written to a new private R2 bucket, played back
as a `blob:`.**

The web app already supplies `openMicrophone` to `ConversationSession`
(`use-streaming-translate.ts:246`), so the tap is a wrapper around one function: the
stream is handed back unchanged and a `MediaRecorder` starts on the same tracks. What is
recorded is the processed signal — `echoCancellation`/`noiseSuppression`/`autoGainControl`
— which is precisely what the STT hears.

It is smallest on every axis: zero CSP change, zero new web-build input, zero new
deploy-smoke case, zero new npm dependency, one new env var, three nullable columns, two
routes on an existing controller, and no change to `packages/realtime-client`'s audio
path. It is also the only approach that records the _conversation_ rather than the turns.

**Rejected, with reasons:**

- **Server-side per-turn PCM buffers.** Fails immediately: `capture-pump.ts` discards
  everything between turns, so the artifact omits every inter-turn moment and its media
  time does not correspond to wall clock — the offsets would point at the wrong audio.
  PCM16 is also 19 MB per 10 minutes with no encoder in the Node stack.
- **Chunked multipart upload during the conversation.** A tab close mid-conversation
  leaves an initiated upload with no completion; R2 bills incomplete parts and nothing here
  would ever abort them. It also puts an HTTP request every N seconds onto the hot path
  where sub-2s turn latency is the headline criterion.
- **Presigned direct-to-R2.** Dead on constraint 2 — `connect-src` blocks it — and it
  would need a new dependency, a CORS policy, a build-time CSP widening and a third
  deploy-smoke case.

**Cheapest to abandon:** the container choice. A different codec is one more entry in the
`isTypeSupported` list and one more signature in the sniff; nothing moves in the schema,
routes or UI. **Not cheap to abandon** is the offset base — if `audioOffsetMs` is wrong,
every timestamp is wrong by the same constant, which is why criterion 10 is a stopwatch
check rather than a unit test.

## Design sketch

**Schema** — one migration, three nullable `ADD COLUMN`, no index, no backfill:
`Conversation.audioKey` (key, not URL — the bucket is never published, so there is no
origin to compose and the route is the only way in), `Conversation.audioOffsetMs`
(milliseconds between `startedAt` and the first recorded sample), `ConversationTurn.offsetMs`.
The `ConversationTurn` docblock that currently says _"No `audioUrl` either; no audio is
retained anywhere"_ is rewritten in the same commit.

**Contracts** — `conversationTurnSchema` gains `offsetMs`; `conversationSchema` gains
`hasRecording: boolean` and `audioOffsetMs`. `conversationSummarySchema` is untouched — the
list card gets no recording marker. **The key never appears in any contract.**
`HISTORY_LIMITS.MAX_CONVERSATION_AUDIO_BYTES = 32 MB`, one decision with the recorder's
`audioBitsPerSecond: 24_000` (3 kB/s reaches the cap at ~2h58m).

**Transport** — one line in `narrow-body-limits.ts`, the file that already owns per-path
ceilings:
`app.use('/conversations/:conversationId/audio', raw({ type: ['audio/webm','audio/mp4'], limit: '32mb' }))`.
`raw` is `express`'s own (`express ^5.2.1` is already a direct dependency), the param-path
mount is legal on Express 5 and isolates the parser to the audio sub-path, and body-parser
dispatches on content type so the two parsers never see each other's bodies. It 413s an
oversized body **before the route runs**. `registerNarrowBodyLimits` is called from both
`main.ts` and the e2e harness, so the new parser is exercised by the suite.

**Storage** — four files mirroring the avatar trio: a
`ConversationAudioStorage` interface (`enabled`, `put`, `get`, `delete`) with R2 and
disabled implementations, a shared `r2-client.ts`, and `conversation-audio.ts` holding the
cap, `sniffConversationAudio` and a **deterministic** key
`conversations/{ownerId}/{conversationId}.{ext}` — deterministic unlike the avatar key
because the bucket is private and uncached, so a content hash buys nothing while a fixed
key makes a retried upload idempotent instead of orphaning the first attempt.
`getConversationAudioConfig` reads `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_AUDIO_BUCKET` — all four or none, and deliberately **no**
`R2_PUBLIC_BASE_URL`, since the absence of a public origin is the point.

**Routes**, both on the existing controller so the owner-scoping discipline is inherited:

- `PUT :conversationId/audio`, 204, throttled 6/min (vs the save's 30, because the memory
  bound is 32 MB × in-flight). Sniffs the bytes (415 on failure), puts the object, then
  writes the columns. 404 for a foreign id, identically to an absent one. 409 when storage
  is disabled or unreachable. 413 from the parser.
- `GET :conversationId/audio` — non-passthrough `@Res()`, **because `TransformInterceptor`
  would otherwise JSON-wrap the stream**. The docblock must record this so the next reader
  does not "fix" it back into the envelope. `Cache-Control: private, no-store`.

`ConversationsService.remove` becomes: read the key → `audio.delete(key)` → **only then**
`store.remove`. That is the avatar precedent and the order that cannot orphan an
unreachable object; the cost is one extra SELECT per delete.

**Client** — `toConversationTurns(state, startedAtMs)` computes each block's offset from
its first member's `openedAt`. A new `use-conversation-recording.ts` owns the
`MediaRecorder`, recording straight through pause and resume — a paused recorder would
desynchronise every offset from the media. Upload fires **once per `conversationId`** and
only once `save.saved` is true: the row must exist before anything can point at it, and a
rename re-save must never re-upload.

**UI** — the bar is a `div` on the page ground bounded by hairlines, with an `outline`
Play and a `Slider` whose filled range is a `div` (which `accentFilledControls` does not
count, since it restricts to `button, a, [role="button"]` — its docblock names the slider
as exactly this case). So surfaces stay 2 and accent stays 1, by construction rather than
by luck. `totalMs` is computed from `endedAt − startedAt − audioOffsetMs`, never read from
`audio.duration`. No `opacity-*` in the gutter — token colours at full opacity, because the
contrast specs read tokens and a composited opacity passes them while breaking the rule
they exist for.

**i18n** — new `web.history.*` keys in both dictionaries, plus the amended landing block.
The title must stay short because it is also a nav label; shifting the claim from _where
the audio stays_ to _where the recognition happens_ keeps it true:

> **Your voice is understood on your machine** — What you say is recognised on your own
> computer; no key to obtain, and nothing is sent away to be understood. When a
> conversation ends, its recording and its words are saved to your history, so you can
> play it back and read it again. Deleting a conversation deletes its recording too.

The comment block above it gains a second paragraph in the idiom of the first amendment.

---

## Amendments required before planning

The verifier ranked this brief against the field and then listed what it still gets wrong.
These are binding on the plan.

**From the two decisions taken after scoring:**

1. **Safari is a live branch, not a degraded fallback.** The brief assumed a Safari reader
   gets timestamps and no audio. Safari is now in scope, so `audio/mp4` must be recorded,
   sniffed (`ftyp` at byte 4), served with the right content type, and **tested on real
   Apple hardware** — criterion 10 now names three browsers.
2. **Click-to-seek is in scope** and this brief already delivers it; keep the `onSeek`
   prop and the text fallback for rows with no offset.

**Correctness fixes:**

3. **The gutter must display media time, not conversation time.** The brief seeks with
   `offsetMs − audioOffsetMs` but _displays_ `offsetMs`, so the gutter and the player
   readout disagree by the permission-prompt interval. Subtract in both places.
4. **`throwOnRequestTimeout: true` on the new S3 client.** In the installed
   `@smithy/node-http-handler` 4.11.3 a bare `requestTimeout` only logs a warning and the
   request keeps running — so the timeout is decorative without it. _(Reported by the
   verifier from the package source; I could not confirm it independently, because this
   repo's `scout-block` hook blocks reads under `node_modules` and I did not work around
   it.)_ Open a separate follow-up: the existing avatar client has the same defect at
   `r2-avatar-storage.ts:66`, and `r2-avatar-storage.spec.ts:59-62` asserts only
   `requestTimeout > 0`, so the spec cannot see it.
5. **Soften the non-decreasing-offsets refine.** As written, one bad offset rejects the
   entire transcript. Clamp or null the offending value instead of failing the save — the
   transcript is the thing that must not be lost.
6. **Adopt authenticated raw fetch with 401 recovery.** A bare `fetch` has no
   token-refresh path, so a stale token makes the player fail on first press after a long
   read. Resolve the bearer as `authedFetch` does and reuse `recoverFromUnauthorized` for
   one retry.
7. **Add magic-byte sniffing as specified** and send the **sniffed** type to R2 as
   `ContentType`, never the client's declared header.
8. **Name the store setter.** `setAudio(ownerId, conversationId, key, offsetMs): Promise<boolean>`
   — boolean so a foreign id answers 404 exactly like an absent one. The upsert's
   `update: parent` must stay exactly `{direction, startedAt, endedAt}`, and that should be
   said in the code, since the audio columns' survival depends on it.
9. **Refuse an oversized blob locally** rather than spending the upload to earn a 413, and
   reuse the existing `Alert variant="live"` region with an outline Retry for upload
   failure, lifting `classify` out of `use-conversation-save.ts` into a shared helper.
10. **Package filter names are wrong throughout.** `pnpm --filter @chatofy/api` does not
    run; the workspace names are `api`, `web`, `types`, `realtime-client`.
11. **Docs.** `docs/system-architecture.md:585-605` ("No audio is retained today") becomes
    the record of why the second bucket exists; `docs/deployment-guide.md` gains the
    second-bucket step; `prod.env.example` and `.env.example` gain `R2_AUDIO_BUCKET` with
    the _inverse_ of the note at `prod.env.example:60-63` — this bucket is not public, and
    dev must not share it with prod.
12. **The copy must say the microphone keeps recording while a conversation is paused**,
    since the recorder deliberately runs through `pause()` to keep offsets aligned. A user
    who believes pause silences the microphone would be wrong.

**Measure first, before writing the player:**

13. **Can a `blob:`-backed WebM be seeked?** Chromium's `MediaRecorder` writes no Duration
    into the WebM header, so `audio.duration` reads `Infinity` and `currentTime` can be
    refused. Record two minutes, set `currentTime = 30`, read it back. The known prime
    (`currentTime = 1e101`, await one `timeupdate`, then seek) is a five-line fix; if it
    fails, the gutter degrades to text and everything else stands. Storing an explicit
    `audioDurationMs` is the robust alternative and was the losing candidate C's choice.
14. **Does `openedAt` mark the start of speech or of capture?** `capture-pump.ts` keeps a
    `PRE_ROLL_MS = 320` buffer before speech is confirmed. If the gutter reads consistently
    early, the fix is one constant — and 320 ms is inside criterion 10's ±1 s tolerance.

---

## Residual risk, stated once

Recording is on by default, so a second person speaking into a Chatofy user's microphone
has their voice uploaded and retained until that user deletes the conversation, with the
landing copy as the only notice and no in-product consent step. With no quota anywhere in
the codebase and retention-until-delete, storage grows as fast as people talk (~1.5 MB per
10 minutes at 24 kbps; ~10.8 MB/hour). The design does what the architecture can: a
private bucket reachable only through an owner-scoped route, and the object deleted before
the row. Both of those are your decisions, recorded, not reopened.

## Ranking appendix

Five independent candidates scored 1–20 on faithfulness, evidence grounding, sharpness of
acceptance criteria, honesty about unknowns, and design soundness.

|                | Score | Note                                                                                                                                                                       |
| -------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A (winner)** | 84    | Only brief delivering click-to-seek with a complete design, and the only one pinning an _existing_ test (the 413 case) as its transport regression proof.                  |
| C              | 89    | Highest raw score. Won on verified-by-running claims — the Express 5 mount and the smithy timeout defect. Lost the selection because it declared click-to-seek a non-goal. |
| E              | 81    | Strong on authenticated fetch and 401 recovery; returns `StreamableFile`, which ships a broken player.                                                                     |
| B              | 79    | Verified the web-owned mic seam; asserted wrongly that the deploy smoke checks only `connect-src`.                                                                         |
| D              | 79    | Best honesty section — names what it did not read. Also returns `StreamableFile`.                                                                                          |

C outscored A, and the verifier selected C **conditionally**, naming in advance the one
thing that would flip it: _"if the controller treats click-to-seek as part of the mockup,
A becomes the winner."_ You confirmed click-to-seek is wanted, so A is the winner and C's
two unique findings (items 4 and 13 above) are carried into it.

## Unresolved questions

1. **Reuse the existing R2 key pair, or mint a second bucket-scoped token?** The winning
   brief reuses `R2_ACCOUNT_ID` and the existing key pair for one new variable, arguing the
   hazard the repo actually names is bucket-level _public access_, not credential blast
   radius. The stricter reading is that a leaked avatar token should not also reach private
   recordings, which costs three variables instead of one. I lean to the second — the
   bucket exists precisely to be an access boundary — but it is your call and it is one
   factory function either way.
2. **Is a 32 MB cap (~2h58m) the right ceiling**, given `MAX_DURATION_MS` permits 24 hours?
   A conversation past the cap gets its transcript stored and its recording refused.
3. **Should the history list card show a recording marker?** The brief deliberately leaves
   `conversationSummarySchema` untouched as scope you did not ask for.
