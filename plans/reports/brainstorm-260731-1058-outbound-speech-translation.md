# Brainstorm — outbound (my-side) speech translation in the extension

Date: 2026-07-31 · Branch: main · Status: accepted direction, not planned yet

## Contract

**Outcome.** While a meeting tab is being translated, my own speech is captured,
translated into the other language, and **injected into the meeting's outgoing
audio**, so the other participants hear it. The conversation becomes two-way.

**Constraints.**

- MV3: the service worker cannot hold an `AudioContext`; the audio graph lives in
  the offscreen document.
- A `MediaStream` cannot cross from the offscreen document into the page. Only
  serializable data can — so audio reaches the tab as base64 PCM, not as a track.
- The session cannot move into the page: a `https://` meeting page cannot open
  `ws://localhost:3000` (mixed content), and the AudioWorklet would need
  `web_accessible_resources`, which `wxt.config.ts` documents as unusable here
  (Chrome rejects a WAR match whose path is not `/*`, e.g. `zoom.us/wc/*`) and
  which would make the extension id probeable from those origins.
- Server ceilings (`session/turn-concurrency.ts`): 3 turns per socket (fairness),
  **6 per process** (the real one — the STT/TTS sidecars are one shared CPU
  process each). Two-way puts both sessions under the same global 6.
- `direction` travels **per turn** in `client.session.start`, so mixed directions
  need no protocol change.

**Non-goals.** Changing the inbound (tab) pipeline's behaviour; server/protocol
changes; mobile and web apps; simultaneous (word-by-word) interpretation — this
stays turn-based, like the existing direction.

**Acceptance.** With capture running on a supported meeting: I speak Vietnamese,
the other participants hear English within the same latency band as the inbound
direction; my own voice is still transmitted, ducked while the translation
plays; no self-translation loop forms; the inbound direction is unaffected.

## Decisions taken

| Question                              | Decision                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Where the outbound translation goes   | **Virtual microphone** — a MAIN-world patch of `navigator.mediaDevices.getUserMedia` hands the meeting client a track we compose |
| What the others hear of my real voice | **Ducked under the translation**, not muted — the interpreter convention, reusing `DuckController`                               |

Rejected: loudspeaker delivery (forces speakers, the meeting client's own echo
canceller may suppress it, and it re-opens the acoustic loop the extension exists
to avoid); text-only (the other side gets nothing).

## Architecture

```
[offscreen document]                              [meeting tab]
  mic ─► gain(gate) ─► MediaStreamDestination
                          │ stream
                          ▼
              ConversationSession (reverse direction)
                          │  ws://localhost:3000/ws/translate
                          ▼
                   OrderedPlayback
                          │ enqueue/stopTurn/stop
                          ▼
                  PagePlaybackQueue ──► worker ──► content (isolated world)
                          ◄── drained                     │ window.postMessage
                                                          ▼
                                          MAIN world: getUserMedia patch
                                            real mic ─► gain(duck) ─┐
                                            base64 PCM ─► scheduler ┴─► dest
                                                                       └─► track
                                                                           returned
                                                                           to the
                                                                           meeting
```

Four parts:

1. **Mic session (offscreen).** A second `ConversationSession`, direction =
   reverse of the tab session's, `continuous: true`, `fullDuplex: true`,
   `maxInFlight: 2` (3 + 2 = 5 ≤ the global 6), `ownsAudioResources: false` —
   it shares the one `AudioContext` the file already owns.

2. **Mic gate (offscreen).** The stream handed to that session is
   `mic → GainNode → MediaStreamAudioDestinationNode`, with the gain dropped to
   zero while the **inbound** translation is playing (`playbackBusy`, already
   tracked). Without it, a user on a loudspeaker has their own microphone hear the
   inbound translation and the app translates its own output. Cost: no barge-in
   while a turn plays — small, because the tab is ducked then and the user is
   listening.

3. **Playback seam (shared package, one change).** `ConversationSession`
   constructs `new PcmPlaybackQueue(context, cb)` internally and
   `PcmPlaybackQueue.enqueue` is hardcoded to `context.destination`. Add one
   optional dep — `createPlaybackQueue?: (context, onTurnDrained) => PlaybackQueue`
   — mirroring the existing `createWorkletNode` / `createSocket` injection, and
   extract the 4-method interface `OrderedPlayback` already depends on. Ordering,
   backlog and the stall watchdog stay in the offscreen document; only the leaf
   that touches an output device moves. The extension passes a
   `PagePlaybackQueue` that forwards `enqueue/stopTurn/stop` to the tab and takes
   `drained` back.

   Frames re-encode to base64 (`pcm16ToBase64`, already in the package) because
   `chrome.runtime` messages are JSON — a typed array would arrive as an object
   with numeric keys. ~5 messages/second per turn.

   The hop goes offscreen → worker → tab: offscreen documents may only use
   `chrome.runtime`, so they cannot call `chrome.tabs.sendMessage` themselves.

4. **MAIN-world patch (new entrypoint).** `world: 'MAIN'`, `run_at:
'document_start'`, same three host matches. Wraps `getUserMedia`: calls the
   real one, builds `src → gain → dest` plus a scheduler for injected PCM into the
   same `dest`, returns a stream carrying `dest`'s audio track and the original
   video tracks untouched. Ducks `gain` while anything is scheduled. Accepts
   commands over `window.postMessage` guarded on `event.source === window`, and
   answers only `drained`.

   A declared MAIN-world content script needs no `web_accessible_resources` and
   is not subject to the page's CSP.

   **Trust boundary:** this code runs in the page's world, where Meet/Zoom/
   Facebook JS can read it. It therefore carries **no transcript text** — only PCM
   of my own translated voice, which the page is about to transmit anyway. The
   overlay's transcript stays in the closed shadow root in the isolated world.

## Risks and honest constraints

- **A page loaded before the extension was installed or updated has no patch.**
  Nothing can inject into it retroactively. Detect it (MAIN pings the isolated
  world on install; absence = not patched) and tell the user to reload the
  meeting, rather than silently sending nothing.
- **The meeting's own mute button mutes the translation too** — it disables the
  track we returned. Arguably correct; must be stated, not discovered.
- **Per-site behaviour is unverified.** The patch is generic, but Zoom's web
  client and Facebook `groupcall` process audio in WASM after capture, and their
  noise suppression / AGC may treat synthesized speech differently from a voice.
  Verify on Meet first, then the other two.
- **Latency is turn-shaped.** The other side hears a translation of a _finished_
  utterance (up to the 8s forced cut), not a simultaneous one. Same as inbound.
- **Load roughly doubles** on the shared STT/TTS sidecars. The global ceiling of 6
  becomes the binding constraint; p95 per-turn latency must be measured before and
  after, not assumed.
- **`EchoMonitor` becomes ambiguous.** It counts microphone speech heard while
  playback sounds; with a mic session running, some of that is now me talking
  normally. Either key it to the gate state or state what the number now means.

## Unresolved questions

1. Do my outbound turns appear in the overlay transcript, and how are they
   distinguished from theirs? (recommend: yes, tagged as mine — otherwise a
   two-way transcript is unreadable)
2. One voice setting for both directions, or a separate voice outbound so the
   other side can tell it is a translation? (recommend: reuse the one setting for
   v1 — YAGNI)
3. Is outbound toggleable separately from inbound, or always both? (recommend:
   separate toggle, default off until the per-site verification above is done)
4. Verification scope for the first cut: Meet only, or all three hosts?
