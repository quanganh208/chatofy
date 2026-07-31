import { MicrophonePatch } from '../../src/microphone-patch';
import { isBootstrap, type PatchReport } from '../../src/outbound-bridge';

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
 * It carries no transcript, no settings, and no extension identity beyond the
 * fact of its presence. The audio it will eventually receive is the user's own
 * translated speech, which the page is about to transmit anyway.
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
  // Before any page script, which is what makes the port handshake below safe.
  runAt: 'document_start',
  registration: 'runtime',
  // WXT otherwise announces itself to the page over `window.postMessage`. On a
  // script whose entire premise is that the page cannot see our channel, that
  // announcement is both noise and a tell.
  noScriptStartedPostMessage: true,
  main() {
    const patch = new MicrophonePatch({
      createContext: () => new AudioContext(),
      // Into the page's console, because that is the only one that exists here.
      // Prefixed, because it is someone else's console.
      onLog: (message) => console.info(`[chatofy] ${message}`),
    });

    const onBootstrap = (event: MessageEvent) => {
      // `event.source === window` is not authentication — it cannot tell the
      // extension from the page. It is only a cheap first filter; the guarantee
      // is that this listener is removed below before any page script has run,
      // so the port is handed over while there is nobody else to catch it.
      if (event.source !== window || !isBootstrap(event.data)) return;
      const [port] = event.ports;
      if (!port) return;

      window.removeEventListener('message', onBootstrap);

      const { nonce } = event.data;
      const report = (message: PatchReport) => port.postMessage(message);

      try {
        patch.install(navigator.mediaDevices);
        report({ type: 'ready', nonce });
      } catch (err) {
        report({
          type: 'failed',
          nonce,
          message: err instanceof Error ? err.message : 'could not patch getUserMedia',
        });
      }
    };

    window.addEventListener('message', onBootstrap);
  },
});
