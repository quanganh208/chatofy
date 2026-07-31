import { BOOTSTRAP_TYPE, asReport } from '../../src/outbound-bridge';

/**
 * Hands the page-world patch a private channel, and tells the worker whether it
 * answered.
 *
 * Separate from the overlay content script because of WHEN it has to run. The
 * overlay is `document_idle`, which is correct for something that draws into a
 * page. This has to be `document_start`: it is the moment before any page script
 * exists, and that is the only moment at which a `MessagePort` can be handed
 * across `window` with nobody able to intercept it.
 *
 * Everything after the handshake travels on the port, which the page has no
 * reference to. The nonce is a second layer, for the case where the ordering
 * assumption above turns out to be wrong on some site.
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
  runAt: 'document_start',
  // Registered by the worker alongside the patch, and only while the outbound
  // direction is on. Left in the manifest it would post its handshake on every
  // meeting page of every install — a one-line tell that identifies a Chatofy
  // user to all three sites, including users who never switch this on. That is
  // the exact exposure dynamic registration was chosen to avoid, and it does not
  // stop being one because this half of the pair carries no patch.
  registration: 'runtime',
  // The page has no business knowing this script exists.
  noScriptStartedPostMessage: true,
  main() {
    const nonce = crypto.randomUUID();
    let answered = false;

    const offer = () => {
      if (answered) return;
      const channel = new MessageChannel();

      channel.port1.onmessage = (event: MessageEvent) => {
        // Validated, not cast. Whatever is on the far end of this port is in the
        // page's world, and a malformed payload here would throw inside a
        // listener where nothing is watching.
        const report = asReport(event.data);
        if (!report || report.nonce !== nonce) return;
        // Once. Anything holding this port could otherwise drive the worker in a
        // loop, and there is nothing further to learn after the first answer.
        if (answered) return;
        answered = true;

        void chrome.runtime
          .sendMessage({
            to: 'worker',
            type: 'patched',
            patched: report.type === 'ready',
            message: report.type === 'failed' ? report.message : undefined,
          })
          .catch(() => undefined);
      };

      window.postMessage({ type: BOOTSTRAP_TYPE, nonce }, window.location.origin, [channel.port2]);
    };

    // Offered twice, because the two halves of this pair are registered
    // dynamically and nothing specifies which of them Chrome injects first. If
    // the patch arrived after the first offer, it heard nothing, and the only
    // symptom would be an overlay telling the user to reload a page that is
    // already correct — while the reload costs them their capture.
    offer();
    document.addEventListener('DOMContentLoaded', offer, { once: true });
  },
});
