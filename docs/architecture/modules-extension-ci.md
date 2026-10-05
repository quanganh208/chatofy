# Modules, Browser Extension and CI/CD

Part of the [system architecture](../system-architecture.md).

## Module Organization

**API:**

- `common/` — shared interceptors, filters, middleware, the global `JwtAuthGuard` and `@Public()`, exceptions, Swagger setup, types
- `modules/` — feature modules:
  - `translate/` — `POST /translate` and `/ws/translate` (voice translation between registered languages; REST behind the global `JwtAuthGuard`, WS checked at upgrade by `ws-auth.ts`)
    - `translate.controller.ts` — HTTP handler
    - `translate.gateway.ts` — WebSocket transport: validates against the shared contract, delegates
    - `services/pipeline-translator.service.ts` — `transcribeAndTranslate()` + `synthesize()`; `translateTurn()` composes them for REST
    - `services/translation-session.service.ts` — Per-connection entrypoint for the WS path: opens, feeds, ends and abandons turns
    - `session/` — the objects that entrypoint drives. `turn-session.ts` holds one turn's state and the rules that can refuse a frame, `turn-audio.ts` owns its buffer and everything derived from the sample rate, `event-channel.ts` is the only place an outbound event is serialized. Also `session-registry`, `turn-speculation`, `turn-timeline`, `live-preview`, `outbound-audio-framer`, `translation-model-policy`, `stream-socket`
    - `services/turn-metrics.recorder.ts` — One log line of stage timings per streamed turn (the JSONL file sink, formerly opt-in via `TURN_METRICS_PATH`, was removed)
    - `audio/wav-codec.ts` — PCM16 ↔ WAV, needed at both ends of the WS path (see [Data Flow](./data-flow.md))
    - `audio/clause-splitter.ts` — Splits a translation into clause-level synthesis units
    - `providers/ai-providers.factory.ts` — Resolves provider trio from registry by kind, memoized per backend selection
    - `providers/register-default-providers.ts` — Composition root: registers concrete providers to registry at module init (STT/TTS/translation/realtime/speakerEmbedding **and `summarization`**)
  - `conversations/` — `PUT/GET/DELETE /conversations/:conversationId`, `GET /conversations`, and `PUT/GET /conversations/:conversationId/audio` (the stored transcript, owner-scoped, cursor-paged, searchable, plus its recording)
    - `conversations.controller.ts` — HTTP handlers; the write and the list are throttled, and the path param is uuid-validated so an oversized id is a 400 rather than a btree-index 500
    - `stores/prisma-conversation.store.ts` — owner-scoped by `(ownerId, clientId)` on every query; a save replaces the turns under `Serializable` with a bounded retry, because two overlapping saves would otherwise collide on the positional unique
  - `minutes/` — `POST/GET /conversations/:conversationId/minutes` (LLM meeting minutes: summary, key points, decisions, action items over a STORED conversation)
    - `minutes.controller.ts` — HTTP handlers; POST generates + overwrites, GET reads (404 when none). Throttled, because generation is a ~4000:1 cost amplifier
    - `minutes.service.ts` — Loads the stored turns through `CONVERSATION_STORE` (404 before any provider call), builds the `Label: text` transcript from `displayText ?? sourceText`, `resolveOnly('summarization')`, maps the model draft onto the stored `MeetingMinutes` (mints action-item ids + timestamp), persists a `failed` record — in its own try/catch — before rethrowing a provider error
    - `interfaces/minutes-store.interface.ts` + `stores/prisma-minutes.store.ts` — the store seam, now bound unconditionally; the interface is what a test substitutes
  - `translation-contexts/` — `GET /translation-contexts`, `PUT/DELETE /translation-contexts/:contextId` (the saved AI Context library, owner-scoped, unpaged because it is bounded at `CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER`)
    - `translation-contexts.controller.ts` — HTTP handlers, all three throttled; the path param is uuid-validated so an oversized id is a 400 rather than a btree-index 500. The owner is always `req.auth!.userId`, never a path or body field
    - `translation-contexts.service.ts` — the per-owner ceiling, which is the one rule no constraint can express: "at most N rows per owner" is a COUNT. Counts first and refuses a CREATE past the ceiling, never a replace — refusing a replace would make a full library permanently uneditable
    - `stores/prisma-translation-context.store.ts` — owner-scoped by `(ownerId, clientId)` on every query; a save replaces the glossary under `Serializable` with a bounded retry, mirroring the conversation-turn replace
    - The store token is deliberately NOT exported: nothing else injects it, because the client resolves a context into hints itself (see [AI Context](./data-flow.md#ai-context-and-the-path-a-hint-takes-to-the-prompt))
  - `auth/` — Identity authority: argon2 password hashing, `JwtAuthAdapter` signing and verifying the API's own access tokens, refresh rotation and revocation, register/verify/login/Google/me/avatar, and password reset. See [Authentication](./authentication.md)
  - `mail/` — One transport interface and three senders (SMTP, console, noop), all wrapped by `GuardedMailSender` for cooldown and budget. `mail-sender.interface.ts` is the single place a subject or body is composed, keyed purpose-first and locale-second so a purpose added in one language only fails `tsc`
  - `storage/` — `AVATAR_STORAGE` and `CONVERSATION_AUDIO_STORAGE`, two seams each with an R2 implementation and a disabled one, chosen at module construction from the same configuration. Also the shared image validator (`avatar-image.ts`), the recording sniffer and key builder (`conversation-audio.ts`), and the Google picture importer. See [Avatar storage](./authentication.md#avatar-storage) and [Conversation recordings](./ai-providers.md#conversation-recordings-and-the-access-boundary-they-do-not-have)
  - `users/` — `PrismaUserRepository` and `toUserContract`, which composes `avatarUrl` from the stored key
  - `redis/` — `REDIS_CLIENT` only, imported by `AuthModule` and nowhere else: refresh-token families are its sole consumer
  - `health/`, `meta/` — `GET /health` (the deploy smoke's probe) and `GET /`

**Web:**

Three route groups, absent from the URL and each owning its chrome: `(marketing)` a
public header and footer, `(auth)` a frame with no navigation and no sign-out, `(app)` a
collapsible sidebar and a thin topbar. A layout applies by file-tree ancestry rather than
by URL — which is how the two lab routes under `/translate` took a plain frame of their
own while `/translate` itself took the product chrome, until both were deleted and the
frame with them.

- `src/i18n/` — Locale resolution. `server.ts` reads the cookie, then negotiates from
  `Accept-Language`, then falls back; `provider.tsx` hands the resolved value down. The
  locale is never resolved in the browser: it is the text content of the whole tree, so a
  client resolution means the server renders one language and hydration renders the other
- `src/components/layout/` — the chrome. `app-chrome.tsx` decides sidebar collapse from
  the route; `app-topbar.tsx` holds only what is true on every route — where you are, the
  locale, the theme. A page cannot reach into it: the portal that let `/translate` put its
  settings gear up there was removed when the gear moved into that screen's own dock
- `app/(app)/translate/page.tsx` — The translator, under the app chrome. Reads the stored settings (`useTranslateSettings`; every consumer on the screen takes them as props — its only other caller is the conversation-defaults section on `/preferences`) and mounts `CascadePanel`
  - `src/hooks/use-streaming-translate.ts` — Binds the streaming conversation to React state and supplies the browser APIs; holds no lifetime of its own
  - `ConversationSession` (`packages/realtime-client/src/conversation/conversation-session.ts`) — Owns one hands-free conversation: microphone, worklet, socket, capture pump and playback, with its dependencies injected so a node test can drive a whole conversation without a browser
  - `packages/realtime-client/src/audio/` — `capture-pump` (the turn-taking policy), `speech-gate`, `ordered-playback`, `pcm-playback-queue`, `pcm-resampler`, `microphone-graph`
  - `src/components/translate/` — Presentational pieces: `cascade-panel` (the screen), `panel-headers`, `transcript-panes`, `conversation-transcript`, and two settings groups that are each a panel plus the popover that opens it — `display-settings-*` from the gear in the dock, `voice-settings-*` from the speaker in the panel header
  - `src/hooks/use-translation-contexts.ts` — the AI Context library, plus `resolveContext` (a stored id against the fetched list) and `toHints` (a context as the wire's hints, `undefined` when nothing is selected). One GET per mount rather than a module cache, because unlike the voice catalog this list is a property of the USER and the editor changes it while they are looking at it
  - `src/components/preferences/ai-context-section.tsx` — the library and its editor, the second and last elevated surface on `/preferences`. INLINE, never a `Dialog`: `design/surface-count.ts` queries `document.body` so portalled content counts, and a third surface fails the accent gate
  - `src/components/translate/context-picker.tsx` — a `Select`, so it spends no accent; renders nothing at all for an empty library, mirroring `VoicePicker`, which is what leaves every existing accent-budget row unchanged
- The output voice is chosen by gender (`voiceGenderSchema` in `@chatofy/types`), which is the only selector that means the same thing to both backends. A caller may also name a concrete voice, but only with an opaque token discovered at runtime from `GET /translate/voices` — never one a client hardcodes, and an unrecognised token falls back to the gender voice rather than failing the turn

**Clients:**

- Web consumes `@chatofy/api-client`. Mobile does not depend on it yet; when it needs an HTTP client it consumes the same package, not a per-app implementation
- The realtime socket lives in `@chatofy/realtime-client`, shared by `apps/web` and
  `apps/extension`. It was extracted from `apps/web` rather than copied: the reason
  is recorded one level down in `SpeechGate.push()`, which returns `isSpeech` so
  `CapturePump` cannot re-derive the threshold, because "two copies of the threshold
  would drift". Two copies of the whole turn-taking policy drift the same way. When
  mobile needs it, it consumes the same package — not a rebuilt WebSocket
  abstraction. A pair of scaffold files that tried the latter was removed unused.

---

## Browser extension path

`apps/extension` translates a browser meeting in **both directions**, and it is the
one surface where capture never stops.

```
service worker ──getMediaStreamId(tabId)──► offscreen document
      ▲                                          │
      │ chrome.runtime message                   ├─ INBOUND: tab → CapturePump(continuous)
      │                                          │           → TurnPipeline → WS /ws/translate
content script (closed Shadow DOM overlay)       │           → OrderedPlayback → destination
      │                                          ├─ GainNode(original) ── duck
      ├──── transcript ◄────────────────────────┤─ separate mic → EchoMonitor
      │                                          └─ OUTBOUND: gated mic → second session
      │                                                      → PagePlaybackSink
      ▼
page world (registered only while outbound is on)
      └─ getUserMedia patched: mic → duck ─┐
                base64 PCM ─► scheduler ───┴─► MediaStreamDestination ─► the meeting
```

**Two directions, two sessions, one context.** Each direction is a
`ConversationSession` differing in four things — its input stream, which way it
translates, how many turns it keeps open, and where its audio goes. Everything else,
which is the whole turn-taking configuration, is shared through
`src/direction-session.ts` so the two cannot drift.

**Either backend, behind one interface.** `CaptureSettings.mode` picks the cascade
above or the continuous model, and `createDirectionSession` returns a
`ConversationSession` or a `LiveDirectionSession` accordingly. `MeetingCapture` drives
both through `DirectionRunner` and never learns which it holds, so the ducking, the
microphone gate, the echo monitor and the teardown ordering are written once. Both
directions of a meeting always run the same mode — mixing them would put two unrelated
latencies on one conversation. On the live path capture runs ungated through
`MicrophoneGraph` (the backend ends an utterance on trailing quiet, so withholding
silence truncates it), ducking follows audible audio because there are no open turns to
count, and transcript text appends to one capped line per direction rather than opening
a turn per sentence. Every piece of state they touch is
either explicitly shared or explicitly split in two: a single flag written by both is
not a tidier version of two flags, it is the outbound turn draining mid-inbound-sentence
and reopening the microphone into our own loudspeaker.

**One AI Context, both directions, resolved once.** `entrypoints/offscreen/main.ts`
supplies `loadContextHints`, which `MeetingCapture` calls ONCE at the start of a
capture and threads as the SAME object into both `inbound.start` and
`outbound.start`. That is the case language-keyed entries exist for: two
concurrent sessions running in opposite directions off one settings object, where
a role-keyed pair would be applied backwards in one of them with nothing on
screen to say so. `src/translation-contexts.ts` never throws — a network failure,
an expired session or an unparseable response all read back as an empty list with
a message — so a context can never prevent a meeting from starting.
`LiveDirectionSession.start` accepts the hints and ignores them, exactly as it
already does for `voiceGender`, which is what keeps one `DirectionRunner` shape
across two backends. The popup has a picker and no editor: authoring 24 term
pairs is the wrong shape for a window that dies on blur, so it happens on web.

The two are **not symmetric on failure**, deliberately. Losing the outbound direction
costs the ability to be understood; losing the inbound one means the capture is
translating nothing, so it ends the capture rather than leaving a recording indicator
lit over a dead pipeline.

**The outgoing microphone can only be reached from the page.** A `MediaStream` cannot
cross from the offscreen document into a tab, so the user's translated speech travels
as base64 PCM through the worker and into a script running in the meeting page's own
world, which wraps `getUserMedia` and hands the meeting client a track fed by a graph
the extension owns. That script is registered at runtime and only while the feature is
on — declared in the manifest it would replace the microphone of every user who
installs the extension and let all three sites fingerprint them.

**That world cannot hold a secret**, and it is measured rather than assumed. An earlier
design transferred a `MessagePort` there at `document_start`, reasoning that no page
script had run yet; `apps/extension/e2e/run.mjs` showed a script in the page's own
`<head>` receiving both the message and the port, because `window.postMessage` queues a
task rather than delivering synchronously. So: nothing confidential is sent there,
nothing it reports is trusted, turn order and lifetime are decided in the offscreen
document, and whether a tab carries the patch is answered by the worker asking Chrome
through `executeScript` rather than by the page claiming it. The privacy control is not
the channel — it is that capture stops entirely while the meeting client is muted.

**Why listening THROUGH playback is safe here by construction.** On web and mobile
the loop can only be ruled out per device, and the reason is acoustic, not
architectural: one device with one loudspeaker means the microphone can hear the
translation and the app translates itself in a loop. In the extension, input is the tab and output is an
offscreen document that is not in the tab's audio graph, so translated audio cannot be
re-captured. The digital loop is gone by construction.

**Half-duplex is no longer the same thing as capture stopping.** They used to be one
setting and are now three, because fusing them cost both of the things each was for:
`continuous` decides only whether a turn ending returns the pump to listening;
`fullDuplex` decides only whether the microphone is honoured while our own audio is
audible; and the echo count runs in every mode. Web now runs continuous **and** full
duplex: capture does not stop for the turn cycle, and input is not discarded while our
translation sounds either, so someone may talk over the playback and be heard.

Whether that second part is safe is an acoustic question about the machine, not about
the code, and it was answered for the machine this runs on rather than by a build
flag — see [`development-journey.md`](../development-journey.md#10-outstanding-work) item 1 for what that verification did
and did not establish. What remains on screen in place of a flag is the echo counter,
which appears beside the level meter the moment it leaves zero: a device where the
loudspeaker does reach the microphone says so there, and then in a transcript filling
with the app's own voice. Half duplex is still the library default, so a client on an
unverified device can turn it off; web is the one that hard-codes it on.

The signal the microphone gate keys on is `PlaybackSink.isPlaying` — audible now —
and never `OrderedPlayback.isBusy`, which is true from the moment a turn OPENS, i.e.
when someone starts talking. A gate keyed on the latter holds the microphone shut for
as long as any turn is in flight and passes every test in a quiet room; see
`apps/extension/src/sounding-sink.ts` for the same conclusion reached independently.

**What that does not fix, and is measured rather than claimed.** The user's own
microphone is still open and the meeting client is still transmitting it. Meet's echo
canceller takes its reference from Meet's own output inside the tab, and the
offscreen document is a different output that reference knows nothing about. Played
through a loudspeaker, the translation reaches everyone in the meeting, and there is a
second-order path — their speaker plays it, their microphone hears it, it returns to
this tab and is translated again. This is not fixable from an extension.
`src/echo-monitor.ts` counts it so the constraint can be stated with a number beside
it; `benchmarks/realtime/analyze-continuous.mjs` reports the count.

**Ducking is free, and its input is not obvious.** Capturing a tab mutes it for the
user, so the extension must play the original back — which means the original
necessarily passes through an `AudioContext` the extension owns, and a `GainNode`
there is the whole mechanism. It follows `OrderedPlayback.isBusy`, which counts turns
still waiting, rather than "is a sample playing": with a growing backlog the latter is
permanently true and the meeting would stay ducked for the whole call.

**Turn segmentation.** Nobody in a meeting leaves 500ms of silence for tens of
seconds, so silence alone cannot end a turn. `SpeechGate` takes a length ceiling and
cuts by looking forward — it arms `cutLookaheadMs` (1500ms by default) before the
ceiling and ends the turn at the first pause of at least 100ms, falling back to a hard
cut. A single quiet block is not enough: connected speech dips below the threshold
between syllables, and cutting there split words in production. Arming is also when
`onProbableEnd` fires, because a forced cut never reaches the silence that would
otherwise buy the head start. In continuous mode the pause a cut lands in goes with
the turn being cut, and the next turn opens on 40ms of speech instead of the usual
120ms confirmation — the speaker is still talking, and waiting for an unbroken 120ms
of syllables dropped audio after the cut. 40ms rather than one block, because once
the lookahead is armed a speaker who really stops is cut too, and a click right after
that must not open a turn.

**Starting it where there is no toolbar.** Facebook opens a call in a `type: "popup"`
window: no tab strip, no extension icon, so the popup cannot be the way capture starts
there. And `tabCapture.getMediaStreamId` requires the extension to have been invoked on
that specific tab — Chrome grants that for an action click, a context-menu item, a
`commands` shortcut, or an omnibox suggestion, and for nothing else. A button drawn by
the content script is a click on the page, not an invocation. So the extension ships a
shortcut (`Alt+Shift+C` by default) and a context-menu item, both routed to one
`toggleCaptureFor` in the worker. The grant then survives until the tab navigates,
which is what lets the overlay's own Start/Stop button work for the rest of the call.
`desktopCapture` would avoid the grant entirely and was rejected: it leaves the tab
playing its own audio, and ducking depends on that audio passing through the
extension's `AudioContext`.

**Consent surface.** The overlay carries a capture indicator with no dismiss control,
shown for as long as capture runs, and the popup shows a recording notice once. Other
participants are not told by their own client, so the person running the extension is
the only one who can know.

The overlay is a collapsed pill until capture starts, and `src/site-enablement.ts`
lets the user switch Chatofy off globally or per platform. Off means the extension
does not act there at all: the content script removes the overlay from the page
rather than hiding it, `refreshMenuTitle` withholds the context-menu item by
rebuilding `documentUrlPatterns`, and `startCapture` refuses.

That gate sits in `startCapture` and not in `toggleCaptureFor`, which is the
non-obvious part. `toggleCaptureFor` serves the shortcut and the context menu, but
the popup's `start` message and the settings handler's reopen both call
`startCapture` directly — a check upstream of it left both able to record on a
platform that had been switched off.

**No preference can take down a running indicator.** Switching off a platform
being captured makes the worker STOP that capture, and `mayUnmountOverlay` keeps
the overlay mounted until the render reporting the stop arrives. Unmounting first
would leave a live recording with nothing on screen saying so for as long as the
two contexts took to agree. Both halves are pure functions in
`src/site-enablement.ts`, which is where their tests are.

Not in scope: Zoom's desktop app (not a tab, so not capturable — the popup says so), diarization,
and any language the registry does not hold yet (today it holds vi and en).

---

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`, workflow name `CI`) on pushes and pull
requests to `main`. The workflow file owns the job list and each job's rationale;
in outline:

- Lint and typecheck (`pnpm turbo run typecheck` catches schema ↔ usage drift)
- Test — `pnpm turbo run test` (unit suites only; see below) plus the root
  `scripts/*.test.mjs`
- Build — `pnpm turbo run build` (mobile has no build script), `verify:build` over
  the artifacts, then a smoke that boots the built web server and requires a 307
  from the route guard on `/translate`. Needs `AUTH_SECRET`: `next build` prerenders
  `/login`, which reads the server-only config. The placeholder there signs nothing —
  the schema stays strict so a real deployment cannot fall back to a default signing
  secret
- API e2e, in two jobs
- Extension e2e (Playwright)
- Display ITN gates, TTS sidecar unit tests (model-free), and realtime replay
  suites over synthesized fixtures that fail rather than skip when absent
- Supply chain (`pnpm audit --audit-level=high`, plus a one-React-per-bundle check)

**Main going red is watched, not just gated.** Branch protection gates what enters
`main` but cannot see a merge commit that fails afterwards.
`.github/workflows/main-failure-alert.yml` follows CI on `main` via `workflow_run`,
opens (or comments on) one `main CI is red` issue on failure or timeout, and closes
it when `main` is green again. Like `deploy.yml`, it matches CI by its `name:`, so
renaming the CI workflow silently stops both.

**Why supply chain is not simply "zero high advisories".** Two entries in
`pnpm-workspace.yaml`'s `auditConfig.ignoreGhsas` are suppressed, because
neither has a patched version in existence — the newest release is itself the
vulnerable range — so no override floor can answer them and the job would fail
on every branch. Add an entry only for an advisory a human has decided is
acceptable; the list does not prune itself, so each carries the condition that
clears it. The command is unchanged and still fails on the next high that is
not on the list.

**Why the api e2e suites get their own jobs.** `pnpm turbo run test` reaches api's
`test` script, whose jest `rootDir` is `src` — so nothing under `apps/api/test/`
had ever run in CI, which is exactly where enforcement is proved. `api-e2e` runs
the fast suites on an in-memory user repository (with a Redis service, because
login mints a refresh family); `api-e2e-db` brings up Postgres and Redis service
containers, applies migrations, checks the migration chain against
`schema.prisma` for drift, and runs every `*.db-e2e-spec.ts` suite. They are split
so the fast ones are not held behind a database.

Deployed to production with `NODE_ENV=production` (disables Swagger `/docs`).

Production itself is a second Docker stack on the maintainer's machine, running
beside the dev stack and sharing nothing with it — separate compose project,
ports and volumes — published through a Cloudflare Tunnel at
`chatofy.quanganh208.dev` (web) and `chatofy-api.quanganh208.dev` (api). A
GitHub Actions self-hosted runner on that same host deploys it, triggered by
`workflow_run` on CI rather than by push, so the deploy follows CI instead of
racing it — and only for a successful run that came from a push to this
repository's own `main`, since `workflow_run` is reachable from a fork's pull
request. Full detail, including the values that are forced rather than chosen
and the rollback paths: [`deployment-guide.md`](../deployment-guide.md).
