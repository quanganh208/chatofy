import { forContext, type OverlayState } from '../../src/messages';
import { asOutboundReport } from '../../src/outbound-channel';
import {
  loadOverlayVisibility,
  overlayShownOn,
  watchOverlayVisibility,
} from '../../src/overlay-visibility';
import { meetingSiteOf } from '../../src/supported-meeting-url';
import { Overlay } from './overlay';

/**
 * The content script: build the overlay, relay between the worker and the page.
 *
 * The overlay itself is in `overlay.ts` and its stylesheet in
 * `overlay-styles.ts`. Split apart when the idle surface became a collapsible
 * pill and this file passed 500 lines — the messaging here and the DOM there are
 * separately reviewable, and only one of them carries the safety invariants.
 *
 * Neither `overlay-visibility` nor `supported-meeting-url` imports
 * `@chatofy/types`, which is why they can be imported here: this bundle is
 * injected into every meeting page and the shared types package has no business
 * on one.
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
  runAt: 'document_idle',
  main() {
    const overlay = new Overlay();
    const site = meetingSiteOf(window.location.href);

    // Read rather than assumed, and re-read on every change. The overlay starts
    // out believing it is wanted, which is the default and also the safe way to be
    // wrong: appearing for the half-second before storage answers is recoverable,
    // and staying away because a read was slow is not visibly a bug at all.
    const applyVisibility = (visibility: Parameters<typeof overlayShownOn>[0]) => {
      overlay.setWanted(overlayShownOn(visibility, site));
    };
    void loadOverlayVisibility()
      .then(applyVisibility)
      .catch(() => undefined);
    watchOverlayVisibility(applyVisibility);

    chrome.runtime.onMessage.addListener((message) => {
      const forContentScript = forContext(message, 'content');
      if (!forContentScript) return;
      if (forContentScript.type === 'render') {
        overlay.render(forContentScript.state);
        return;
      }
      // The last hop into the page's own world, where the patch is listening.
      // Nothing confidential travels here — see `src/outbound-channel.ts`.
      window.postMessage(forContentScript.command, window.origin);
    });

    // And the one fact coming back: whether the meeting client is still
    // transmitting the microphone it was handed.
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const report = asOutboundReport(event.data);
      if (!report) return;
      void chrome.runtime
        .sendMessage({
          to: 'worker',
          type: 'outbound.transmitting',
          transmitting: report.transmitting,
        })
        .catch(() => undefined);
    });

    // Asked for on load rather than waited for: this script may be injected long
    // after capture began — a reload mid-meeting — and would otherwise show nothing
    // until the next turn.
    void chrome.runtime
      .sendMessage({ to: 'worker', type: 'query' })
      .then((state: OverlayState | undefined) => {
        if (state) overlay.render(state);
      })
      .catch(() => undefined);
  },
});
