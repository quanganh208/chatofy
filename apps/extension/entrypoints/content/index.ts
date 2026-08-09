import { forContext, type OverlayState } from '../../src/messages';
import { asOutboundReport } from '../../src/outbound-channel';
import {
  loadSiteEnablement,
  mayUnmountOverlay,
  runsOn,
  watchSiteEnablement,
  type SiteEnablement,
} from '../../src/site-enablement';
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
 * Neither `site-enablement` nor `supported-meeting-url` imports `@chatofy/types`,
 * which is why they can be imported here: this bundle is injected into every
 * meeting page and the shared types package has no business on one.
 *
 * This script itself always runs — its `matches` are static in the manifest and
 * Chrome does not consult a preference before injecting. What it does about a
 * platform the user switched off is put nothing on the page at all: no host
 * element, not a hidden one. That is the difference between "off" meaning a
 * panel is hidden and "off" meaning the extension left no trace.
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
    const site = meetingSiteOf(window.location.href);

    let overlay: Overlay | undefined;
    /**
     * The last state the worker sent, held for two reasons.
     *
     * An overlay mounted after a preference change has to be given the state it
     * missed, or a capture already running would show an empty panel. And the
     * unmount guard needs to know whether anything is being captured, which only
     * this record says.
     */
    let state: OverlayState | undefined;
    /**
     * Starts true, which is both the default and the safe way to be wrong: the
     * overlay appearing for the moment before storage answers is recoverable, and
     * staying away because a read was slow is not visibly a bug at all.
     */
    let runsHere = true;

    /**
     * Bring the page into line with the preference and the capture state.
     *
     * Called after every change to either, because the two interact: switching a
     * platform off while it is capturing must NOT take the overlay down — the
     * worker stops that capture, and the render reporting it stopped is what
     * finally releases the guard. Unmounting first would leave a meeting being
     * recorded with nothing on screen saying so for as long as the two contexts
     * took to agree.
     */
    const reconcile = (): void => {
      if (runsHere) {
        if (!overlay) {
          overlay = new Overlay();
          if (state) overlay.render(state);
        }
        return;
      }
      if (overlay && mayUnmountOverlay({ capturing: state?.capturing ?? false, runsHere })) {
        overlay.destroy();
        overlay = undefined;
      }
    };

    const applyEnablement = (enablement: SiteEnablement): void => {
      runsHere = runsOn(enablement, site);
      reconcile();
    };

    reconcile();
    void loadSiteEnablement()
      .then(applyEnablement)
      .catch(() => undefined);
    watchSiteEnablement(applyEnablement);

    chrome.runtime.onMessage.addListener((message) => {
      const forContentScript = forContext(message, 'content');
      if (!forContentScript) return;
      if (forContentScript.type === 'render') {
        state = forContentScript.state;
        overlay?.render(state);
        // A capture that has just stopped is what lets a pending unmount happen.
        reconcile();
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
      .then((current: OverlayState | undefined) => {
        if (!current) return;
        state = current;
        overlay?.render(current);
        reconcile();
      })
      .catch(() => undefined);
  },
});
