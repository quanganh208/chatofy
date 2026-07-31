import { MicrophonePatch } from '../../src/microphone-patch';

/**
 * The one piece of Chatofy that runs in the meeting page's own world.
 *
 * It is here because there is nowhere else: the outgoing microphone belongs to
 * the page, and an extension cannot reach it from anywhere that is not the page.
 *
 * `registration: 'runtime'` — this is NOT in the manifest, and is registered by
 * the service worker only while the user has the outbound direction switched on.
 * A statically declared version would run for everyone who installs the
 * extension, on every meeting they open, replacing the microphone of people who
 * never asked for this. It would also be detectable in one line
 * (`Object.getOwnPropertyDescriptor(navigator.mediaDevices, 'getUserMedia')`),
 * letting all three sites fingerprint every Chatofy user — reopening, by another
 * door, exactly what `wxt.config.ts` declines `web_accessible_resources` to keep
 * shut.
 *
 * There is no handshake and nothing to wait for, and that is a measured decision
 * rather than a simplification. An earlier version had the isolated world
 * transfer a `MessagePort` here at `document_start`, on the reasoning that no
 * page script had run yet so nobody could intercept it. The end-to-end harness
 * disproved it: a script in the page's own `<head>` sees the message and
 * receives the port. `window.postMessage` queues a task rather than delivering
 * synchronously, so "injected before page scripts" does not mean "delivered
 * before page scripts".
 *
 * The consequence governs the phase that will ship audio through here: **this
 * world cannot hold a secret.** It is the page's world. Anything sent to it is
 * readable by the page, and anything it reports back is forgeable — which is why
 * whether a tab carries this patch is now answered by the worker asking Chrome,
 * rather than by this script claiming it.
 */
export default defineContentScript({
  // Must stay in step with `host_permissions` and `supportOf` in
  // `src/supported-meeting-url.ts`. WXT reads this statically, so it cannot be
  // imported from there.
  matches: [
    'https://meet.google.com/*',
    'https://*.zoom.us/wc/*',
    'https://*.facebook.com/groupcall/*',
  ],
  world: 'MAIN',
  // Before the page's own code can call `getUserMedia`.
  runAt: 'document_start',
  registration: 'runtime',
  // WXT otherwise announces itself to the page over `window.postMessage`. On a
  // script whose whole point is to be quiet, that announcement is a tell.
  noScriptStartedPostMessage: true,
  main() {
    const patch = new MicrophonePatch({
      createContext: () => new AudioContext(),
      // Into the page's console, because that is the only one that exists here.
      // Prefixed, because it is someone else's console.
      onLog: (message) => console.info(`[chatofy] ${message}`),
    });
    patch.install(navigator.mediaDevices);
  },
});
