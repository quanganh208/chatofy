# Review — PR #135 `feat(conversations): store recordings on R2 with per-utterance timestamps`

Head `68e32b72`. Every finding below was re-verified by opening the cited lines in the PR head tree; findings from the five candidate passes that did not survive that check are listed at the end with the reason.

## Summary

The API half is well built — owner scoping, byte sniffing, the SERIALIZABLE transcript replace and the object-before-row delete order all check out and are tested — but the playback half ships with its primary control broken (the first press of Play never plays), the three new React hooks each have a lifecycle hole that happy-dom cannot see, and the upload/delete pair is non-atomic in two interleavings that strand a private recording in a public-read bucket after the user asked for it to be deleted. 27k lines of unrelated benchmark data and agent transcripts ride along.

## Risk level: High

## Findings

### Critical

**C1. The first press of Play loads the bytes and never plays them.**
`apps/web/src/hooks/use-conversation-player.ts:159-167`, `:132-157`. `toggle` on the unloaded path calls only `load()`, which sets `src` and returns; the source-attached effect auto-plays only when `pendingSeekRef.current !== null`, and the sole writer of that ref is `seekTo` (`:176`). `<audio preload="none">` (`conversation-detail.tsx:195`) has no autoplay. Scenario: open `/history/<id>`, press Play → button disables during fetch, re-enables still showing Play, silence; a second press is required. The hook's own contract (`:17`, "Loads on the first call") says the opposite. No spec exists for this hook, which is why CI is green.

**C2. `setAudio` and `remove` are four unsynchronised round-trips, and two interleavings strand a recording in the public-read bucket that no later delete can reach.**
`apps/api/src/modules/conversations/conversations.service.ts:129-141`, `:204-214`.
(a) Two overlapping first uploads (a proxy timeout at 60 s while R2's own deadline is 120 s, then the user presses Retry) both read `findAudioKey === null` and each mint a different key at `:141`; both `put`s land, the row names one, the other object is orphaned. The docblock at `conversation-audio.ts:93-99` asserts the key is minted once — true only under serial execution.
(b) Delete-then-upload: `remove()` reads `findAudioKey` → null (upload not yet written), skips the object delete, then `setAudio()` puts the object and `store.setAudio` succeeds (row still present, `count = 1`), then `store.remove` deletes the row. Both requests answer 204; the object survives with nothing pointing at it. The compensating delete at `:161` only fires when the row-delete wins, so it structurally cannot cover this order. The PR body lists "an upload racing a delete" among the findings "fixed too"; it is fixed in one direction only.
Consequence is not covered by the public-bucket decision: the decision's stated mitigation is that `DELETE` removes the object, and here it cannot. Fix: have the store delete return the row's `audioKey` atomically (`prisma.conversation.delete` returns the deleted record) and mint the key under a conditional update (`where audioKey IS NULL`) before the `put`. No e2e interleaves the two requests; `conversations.db-e2e-spec.ts:181` covers overlapping saves only.

### Important

**I1. `recorder.start()` sits outside the try/catch, so a recorder failure aborts the whole conversation start and leaks a live microphone.**
`apps/web/src/hooks/use-conversation-recording.ts:139` (the try closes at `:118`). `attach` is the entire body of `openMicrophone` (`use-streaming-translate.ts:272`), so a throw from `start()` rejects `this.deps.openMicrophone()` at `conversation-session.ts:515` before `local.stream` is assigned; the catch at `:688-703` calls `releaseResources(local)` with no stream in it, so the tracks `getUserMedia` already handed over are never stopped, and the user gets the raw DOMException text in the error banner. Contradicts the hook's own invariant at `:36-39` and `:113-117`. `FakeMediaRecorder.start()` in the spec never throws.

**I2. The upload hook's `failure`/`uploaded` state is not tied to the conversation it describes.**
`apps/web/src/hooks/use-conversation-audio-upload.ts:77-91`, `:93-115`; `use-streaming-translate.ts:418-422`; `cascade-panel.tsx:364`.
(a) Conversation 1's upload fails with a 503 → `failure = 'retryable'`. Start conversation 2: `start` nulls the recording and mints a new id, but the only reset `setFailure(null)` (`:99`) is behind `recording?.blob && saved`, false for the whole of the running conversation. The alert stays on screen during conversation 2 and `retry` (`:113`) silently returns because `recording` is null — a live banner about a conversation the user left, with a Retry that does nothing.
(b) `send` captures no attempt id: if conversation 1's slow upload resolves after conversation 2 has ended and started its own upload, `setUploaded(true)` / `setFailure(...)` at `:83-85` are attributed to conversation 2, and `retry()` re-sends conversation 2's blob for conversation 1's failure. The spec (`:138-145`) jumps c-1 → c-2 with a recording already present, so neither path is exercised.

**I3. Pressing Retry unmounts the entire alert, and `web.translate.recordingUploading` is unreachable.**
`use-conversation-audio-upload.ts:79-80`; `cascade-panel.tsx:364-381`. `send()` batches `setUploading(true); setFailure(null)`, and the alert's mount condition is `audioUpload.failure` alone, so the next render removes the alert including its own button — the user sees the error vanish with nothing replacing it, and it reappears from nowhere if the retry fails. The "Saving the recording…" label at `:379-380` is nested inside the `failure === 'retryable'` branch, which is already null whenever `uploading` is true, so the string in `en.ts:298` / `vi.ts` is dead.

**I4. `scrubTo` before the bytes load discards the position it just displayed.**
`use-conversation-player.ts:187-198`. Drag the slider to 2:00 on an untouched bar: `setPositionMs(120_000)` updates the readout and thumb, then `if (!audio || !src) return` without writing `pendingSeekRef`. Press Play → playback starts at 0:00 and the first `timeupdate` snaps the readout back. The docblock (`:26-34`) correctly argues scrub should not start playback; it should still remember where.

**I5. No `error` listener on the media element, so an undecodable recording is a permanently dead bar with no message.**
`use-conversation-player.ts:139-142` registers only `play`/`pause`/`ended`/`timeupdate`; `conversation-detail.tsx:195` has no `onError`. `failed` is set only in `load()`'s catch (`:119-123`), i.e. transport failures. A WebM/Opus recording opened in Safari, or a truncated object, fetches fine, the element fires `error`, `play` never fires, and `web.history.recordingFailed` never renders. Compounds S2 (a `video/mp4` payload passes the sniff and lands here).

**I6. `load()` has no cancellation or generation guard.**
`use-conversation-player.ts:92-101`, `:112-127`.
(a) Reachable today: press Play on a 30 MB recording and navigate back to `/history` before the fetch resolves — the unmount cleanup at `:106-110` ran against `src === null`, then `URL.createObjectURL(blob)` at `:118` runs anyway; the URL never reaches state, is never revoked, and pins the bytes for the life of the document. The docblock at `:103-105` claims the unmount effect prevents exactly this.
(b) `loading` is state, not a ref, so two gutter timestamps clicked in one tick (gutter buttons are not disabled during loading, unlike Play at `conversation-detail.tsx:173`) both pass `if (src || loading)` and start two fetches; the losing `createObjectURL` leaks the same way.
(c) Latent (no UI links detail pages today, `conversation-detail.tsx:92-93`): the `[conversationId]` reset effect clears `src` but not `loading` and cannot cancel A's in-flight fetch, so A's bytes attach under B — the exact failure the effect's comment at `:85-91` says it exists to prevent — and B's Play is inert until A's request settles.
One `AbortController` or generation counter checked after the `await` closes all three.

**I7. `404` is missing from `TERMINAL`, so a conversation deleted mid-upload offers a Retry that can never succeed.**
`apps/web/src/lib/api-failure.ts:26` — `new Set([400, 401, 409, 413, 415])`. The audio route documents 404 as a first-class answer (`conversations.controller.ts:151`, service `:139` and `:162`). `classifyApiFailure` returns `retryable`, `cascade-panel.tsx:372` renders Retry, every press re-sends the full blob and takes 404 again. The justification was inherited verbatim from the transcript hook (`use-conversation-save.ts:257-265`, "a 404 cannot occur on a PUT that creates") and not re-derived for the new caller. Neither retry case in `use-conversation-audio-upload.spec.tsx:164-185` drives a 404.

**I8. The compensating delete swallows its failure with no log.**
`conversations.service.ts:161` — `await this.audio.delete(key).catch(() => undefined)`. When this path fires (row deleted mid-upload) and the delete also fails, a recording of a private conversation stays in the public-read bucket with no row, no log line carrying the key, and no reaper. The storage interface's own docblock (`conversation-audio-storage.interface.ts:63-74`) names silent deletion of a public object as the one outcome it exists to prevent, and `remove()` honours it (`:206-210`). Keep the 404; log the key at `warn`.

**I9. The 32 MB raw body is buffered before authentication and throttling, with only a per-IP in-memory rate limit and no global in-flight ceiling.**
`apps/api/src/common/middleware/narrow-body-limits.ts:65-71` is mounted via `app.use` at `main.ts:23`, i.e. Express middleware that runs before Nest's global `JwtAuthGuard` (`auth.module.ts:113`) and the controller `ThrottlerGuard`; `@Throttle({limit: 6, ttl: 60_000})` (`conversations.controller.ts:145`) bounds request starts per client address in process memory (`auth.module.ts:68-71`), not concurrency, and `@Body() body: Buffer` holds the whole body for the R2 round trip (up to 120 s). An unauthenticated client pays nothing to make the API allocate 32 MB × N before a 401; N signed-in clients on distinct addresses hold 32 MB × 6 × N. The controller's docblock (`:138-140`) names `turn-concurrency.ts`'s `MAX_TURN_BYTES × concurrency` as the precedent, whose global cap (`MAX_CONCURRENT_TURNS_GLOBAL = 6`, `turn-concurrency.ts:45`) is the half not applied here. Reject anonymous requests ahead of `raw()`, and add a process-wide in-flight counter.

**I10. A conversation with a recording becomes undeletable when storage cannot delete, and the operator docs say the opposite.**
`conversations.service.ts:204-211` throws (409 via `asConflict`) before `store.remove` on any non-404 delete failure; `DisabledConversationAudioStorage.delete` (`:32-34`) always rejects. So if R2 credentials are removed, rotated to a token without `DeleteObject`, or R2 is down, every delete of a recorded conversation 409s forever and the only route that removes personal data is closed; `delete-conversation-button.tsx:127` shows only `deleteFailed`. The design is deliberate and correctly argued in the interface docblock — the reportable defect is that `docs/deployment-guide.md:370-373` says the transcript half is "unaffected — conversations save, read back and search exactly as they do with R2 configured" (false for DELETE), and both `deployment-guide.md:60`/`:369-370` and `docs/system-architecture.md:643-645` say "the two recording routes answer 409" (false for `GET /:id/audio`, which 404s at service `:171-175` before consulting `enabled` at `:177`). The PR's own pre-deploy note checks only that the token can _write_ under `conversations/`.

**I11. Recording is on by default with no in-app indication, and the only notice omits the world-readable property.**
`cascade-panel.tsx` renders nothing about recording except the failure alert (`:364`); `use-conversation-recording.ts:71-78` keeps the recorder running through Pause by design. The landing copy (`packages/i18n/src/en.ts:498-499`) — which `docs/deployment-guide.md:356` calls "this product's only privacy notice" — states retention and the pause behaviour but not that every recording is fetchable by URL without authentication, which `prod.env.example` and `storage.module.ts` state plainly. A signed-in user on `/translate` never sees the landing page, and the second party in a two-speaker session sees nothing at all. Not asking to reverse the bucket or default-on decisions; the missing in-session indicator and the omission in the notice are gaps those decisions do not cover.

**I12. Test gaps that leave the headline feature and its stated invariants unproven.**

- `use-conversation-player.ts` has no spec, and `conversation-detail.spec.tsx:55-56` promises "Cases that want the bar override it" — no such case exists; `hasRecording: true` appears only in the accent-budget spec, which counts colours. C1, I4, I5, I6 all pass CI.
- `apps/api/test/conversations.db-e2e-spec.ts` never round-trips a non-null `offsetMs` (`:122`, `:134` are the only turn-level hits, both `null`); never reads `hasRecording`/`audioOffsetMs`/`audioDurationMs` back through `GET /conversations/:id` (zero hits in the file); has no upload → re-save → GET case proving the `update: parent` invariant at `prisma-conversation.store.ts:134-141`, and the in-memory double bakes that invariant in (`in-memory-conversation.store.ts:56-68`) rather than deriving it; has no concurrent-upload or upload/delete interleaving case (C2); overrides `ThrottlerGuard`, so the 6/min limit is asserted nowhere.

**I13. 27,038 lines across 133 files of unrelated work ride in this PR.**
`git diff --stat base..HEAD -- benchmarks plans` → 133 files, +27,038: a complete Vietnamese TTS benchmark package (`benchmarks/tts-vi/**`, commits `fac78735`, `f47a3a45`), a second unrelated plan, and ~12.9k lines of committed agent process output (`plans/reports/orchestrate-260914-1410/review-zerotts-benchmark/**` — `attempt-3/stderr.txt` alone is 7,228 lines, plus `prompt-embedded.txt`). The `README.md:346` licence-table change belongs to that work. Code-only is 55 files / +4,231. Split the benchmark into its own PR; drop the stderr/prompt transcripts regardless.

**I14. The PR body fails the repo's own contract hook.**
`.claude/hooks/lib/pr-body-contract.cjs` → `ok:false`: seven required sections missing (`end-to-end-summary`, `subagent-delegation`, `technical-decisions`, `deviations-from-plan`, `completion-evidence`, `checklist`, `human-actions-required`) and two traceability fields (`linked-issues`, `ship-mode`). The author's own deploy prerequisite — the R2 token must write under `conversations/` — belongs in `human-actions-required`.

### Suggestion

**S1.** `use-conversation-player.ts:93-96` — `URL.revokeObjectURL` runs inside a `setState` updater. Updaters must be pure (StrictMode double-invokes them); the revoke is also redundant with the `[src]` cleanup at `:106-110`, which fires when `src` goes to null. Move it out of the updater. (The "permanently dead player" scenario one candidate attached to this does not hold — React replays a discarded updater on the same base state and a second revoke is a no-op.)

**S2.** `apps/api/src/modules/storage/conversation-audio.ts:39` — the MP4 branch matches any ISO-BMFF `ftyp` box, so `video/mp4`, `.mov` and HEIC payloads are stored as `audio/mp4` and served to an `<audio>` element that cannot decode them. Check the major brand at offset 8; `db-e2e-spec.ts:634-648` constructs `M4A ` but never asserts a non-audio brand is refused.

**S3.** `conversations.service.ts:141` — `existing ?? buildConversationAudioKey(ownerId, type)` reuses a `.webm` key when a re-upload of the same conversation is MP4 (Chrome, then Safari). Playback works (the stored `ContentType` is the sniffed one) but the key extension lies, which matters for the manual prefix cleanup the deployment guide recommends.

**S4.** `conversations.service.ts:203-215` — if the object delete succeeds and `store.remove` then throws, the row keeps `audioKey`, `hasRecording` stays true, and Play answers 404 until the user deletes again (which succeeds via `isMissingObject`). Clear the audio columns after a successful object delete, before the row delete.

**S5.** `history-transcript.tsx:12-13` says a null `audioOffsetMs` "is also what makes the gutter silent"; `mediaOffset` (`conversation-formatting.ts:170-172`) returns `Math.max(0, offsetMs - 0)` for null, so the gutter renders conversation-relative times as plain text. `history-transcript.spec.tsx:143-149` asserts `<time>` is present — it proves the code and disproves the comment. `docs/deployment-guide.md:372-373` ("no player and no timestamps") repeats the wrong claim.

**S6.** `history-transcript.tsx:65` — the `w-12` (3 rem) gutter is sized for `m:ss`; `formatOffset` emits `h:mm:ss` past an hour (`conversation-formatting.ts:148-149`). Layout is invisible to happy-dom, so this is a review item: check a 70-minute recording does not wrap the column the comment says must stay straight.

**S7.** `conversation-detail.tsx:81-83` with `http/conversations.ts:112` — `durationMs` may be 0, giving the Radix `Slider` `max={0}`. Clamp to `Math.max(1, …)`.

**S8.** `cascade-panel.tsx:186` — `startedAt ? Date.parse(…) : 0` would turn every `offsetMs` into an epoch value and 400 the whole save; `conversation-turns.ts:98` clamps the floor but not `MAX_DURATION_MS`, unlike what the schema comment at `http/conversations.ts:82-84` promises. Both unreachable today (`identity` is never re-nulled; the `endedAt` refine catches clock jumps first); worth guarding rather than defaulting to the epoch.

**S9.** `packages/realtime-client/src/state/conversation-turns.ts:59-62` — `toConversationTurns` gained a required second parameter on a package export shared with extension/mobile. One caller today (`cascade-panel.tsx:175`); a stale caller would compute `NaN`, fail `z.number().int()`, and 400 every transcript save. Default it or guard with `Number.isFinite`.

**S10.** `use-conversation-audio-upload.ts:10-11`, `:69`, `:83` — `uploaded` is read by nothing but the hook's own spec; `cascade-panel.tsx` consumes only `failure`, `uploading`, `retry`.

**S11.** `apps/web/src/clients/api-client.ts:166-196` — neither the 32 MB PUT nor the GET carries an `AbortSignal` or deadline, so a stalled uplink leaves `uploading` true indefinitely; and `authedRaw` (`:127-135`) never consumes or cancels the first 401 response's body before re-sending.

**S12.** `conversations.controller.ts:203` — `pipeline(object.body, res)` rejects with `ERR_STREAM_PREMATURE_CLOSE` whenever a client stops a download; `AllExceptionsFilter` correctly bails on `headersSent` (`all-exceptions.filter.ts:102-105`) but does so via `logger.error`. Pausing a recording is not an error; catch premature-close around the pipeline.

**S13.** `packages/types/src/http/conversations.spec.ts:109-118` — the "one decision" pairing test hard-codes `24_000`; `AUDIO_BITS_PER_SECOND` lives unexported at `use-conversation-recording.ts:27`, so changing the recorder's bitrate leaves the test green. Export the bitrate from `@chatofy/types` and read it in both places.

**S14.** `accent-budget-app.spec.tsx:157` — every `/translate` row uses `recording: null`, so the new recording-failure alert (a reachable `/translate` screen-state) has no row. `KNOWN_VIOLATIONS` is correctly `{}` (`:705`) and the two `/history/[conversationId]` rows genuinely assert.

**S15.** `conversation-audio.ts:86-89` says "never make the key derivable", but `ownerId` is already public — `buildAvatarKey` (`avatar-image.ts:92`) puts the same `userId` in a publicly served path. Not exploitable (the residual 64 bits are the control, and R2 public buckets do not serve LIST); the docblock and `system-architecture.md`'s "owner-scoped route" bullet should say plainly that entropy is the whole control and route scoping only limits key disclosure.

**S16.** The recording's only copy is in-memory React state with no ceiling and no lifecycle guard: `recorder.start()` (`use-conversation-recording.ts:139`) has no timeslice or size cap, so a >3h06m conversation records in full and is then refused as `terminal` at `use-conversation-audio-upload.ts:101-105` with no request and no warning; leaving `/translate` mid-conversation enqueues the transcript save on unmount (`use-conversation-save.ts:236-246`) but the `status === 'idle'` collector (`use-streaming-translate.ts:431-440`) cannot run on an unmounting component, so the recording is silently dropped; and after a failed upload, navigating to `/history` unmounts `CascadePanel` and destroys the blob with no `beforeunload` guard.

**S17.** `packages/types/src/domain/conversation.ts:62`, `:110`, `:120`, `:129` — the detail response gained four required fields with no `.default()`, while the write side got `.default(null)` and a 25-line rationale for the stale-bundle window (`http/conversations.ts:86-94`). `deploy.yml:202` brings api and web up in one `compose up -d --wait`, so the forward window is seconds; an API-only rollback, however, makes `getConversation` (`api-client.ts:261`) throw for every detail page and `conversation-detail.tsx:100-103` renders all of them as "deleted". Either tolerate on the read side or record the deploy-order requirement.

**S18.** Product call for the owner, not a defect: there is no opt-out for recording anywhere in `translate-settings.ts` or the voice settings panels. Flagged once.

**S19.** Size and style: `prisma-conversation.store.ts` (456 lines, pre-existing, grown), `conversation-detail.tsx` (293), `api-client.ts` (442) against the 200-line guidance; the new e2e block's comments restate the line beneath them (`// First, create a conversation so we can upload audio to it`), unlike the rest of the file.

## Verified clean (stated so absence is legible)

Authorization/IDOR (every store method owner-scoped on `ownerId_clientId`, `req.auth!.userId` the only owner source, foreign/absent/no-recording answer identical 404s, key never serialised — `toAudio` drops it and the schema has no field). Content sniffing decides the stored `ContentType` and the key extension; no caller-supplied key segment. Migration: four nullable columns, no index needed (nothing filters or sorts on them). `update: parent` at `prisma-conversation.store.ts:134-141` really does preserve a recording across a speaker rename. `use-conversation-recording.spec.tsx` genuinely reproduces the auto-stop ordering (`endOfStream()` fires `dataavailable` → `stop` with no caller; `explicitStops === 0` asserted). i18n: all eight new keys present in both `en.ts` and `vi.ts`. `KNOWN_VIOLATIONS` is `{}`. `AllExceptionsFilter` guards `headersSent`. CI is fully green.

## Verdict: Request changes

Blocking on C1 (the feature's primary control does not work on first press), C2 (two interleavings strand a private recording in a public bucket after a delete the user was told succeeded, one of which the PR body claims fixed), I1 (a recorder failure takes down the conversation and leaks the microphone), and I13 (the 4,231 lines that matter are not reviewable inside 31k). I2–I12 and I14 should land in the same revision; the Suggestions can follow.

## Dropped

- **"Impure updater permanently kills the player" (one candidate, Important)** — the code fact holds and is kept as S1, but the failure scenario is false: a discarded render's updater is replayed on the same base state, and revoking an already-revoked URL is a no-op. Downgraded, not dropped.
- **"Read-contract strictness" at Important (two candidates)** — re-ranked to S17: `deploy.yml:202` deploys api and web in one `compose up`, so only an API-only rollback reaches it.
- **"32 MB buffering" at Critical (one candidate)** — re-ranked to I9: it is a DoS amplification on a route that already had an unauthenticated 12 MB JSON ceiling, not data loss or a security hole.
- **"Recording on by default" at Critical (one candidate)** — default-on and the public bucket are stated product decisions; the in-app notice gap and the notice's omission are kept at I11, the opt-out at S18, per the repo's review rules.
- **"No drift detection between media time and wall clock" (one candidate)** — speculative; no defect demonstrated in the code.
- **"Recording ceiling / unmount collection" at Important (one candidate)** — real but requires a >3-hour conversation or navigating away mid-conversation; merged into S16.
- **Candidate 5's `eslint --fix` mutation of `same-origin-path.ts` in the worktree** — a review-process artefact, not a PR finding.
- Any claim that a CI gate is broken — none survived; all 10 checks pass.
