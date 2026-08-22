import { markRecordingNoticeSeen, recordingNoticeSeen } from '../../src/settings';

/**
 * The recording notice, kept out of React on purpose.
 *
 * It is the only legally meaningful thing on this surface — it says the meeting's
 * audio is being sent somewhere — and its markup stays in `index.html`, where it
 * renders whether or not a script ran. Putting it in the component tree would move
 * that declaration into the part of the page that can fail, and the failure has a
 * shape worth naming: `#toggle` is a sibling of `#consent`, not a child, so an
 * error boundary added later could easily render the footer while the consent
 * branch throws. That is a popup with a working Start button and no notice.
 *
 * So this module owns the panel by hand, and React only subscribes. The click
 * handler is attached at module load, before anything renders, so dismissing the
 * notice works even if the tree below never mounts.
 *
 * The snapshot is `undefined` until storage answers. That is not the same as
 * `false`: rendering the app during that window would show the settings to someone
 * who has not seen the notice, which is the exact thing being prevented.
 */

let required: boolean | undefined;
const listeners = new Set<() => void>();

const panel = document.getElementById('consent');
const acknowledge = document.getElementById('consent-ok');

function announce(): void {
  for (const listener of listeners) listener();
}

acknowledge?.addEventListener('click', () => {
  required = false;
  if (panel) panel.hidden = true;
  announce();
  void markRecordingNoticeSeen();
});

void recordingNoticeSeen()
  .then((seen) => {
    // Only if nothing has decided yet. The button cannot realistically be pressed
    // before this resolves — the panel is hidden until it does — but a late answer
    // overwriting an acknowledgement would put the notice back up over a popup the
    // reader had already dismissed.
    if (required !== undefined) return;
    required = !seen;
    if (panel) panel.hidden = seen;
    announce();
  })
  .catch(() => {
    // Storage is unreadable. Show the notice: the failure mode worth avoiding is
    // capture without the declaration, not a notice shown twice.
    if (required !== undefined) return;
    required = true;
    if (panel) panel.hidden = false;
    announce();
  });

/**
 * Arrow properties rather than methods, because `useSyncExternalStore` is handed
 * both of these detached from the object and a method would arrive with no `this`.
 */
export const consentGate = {
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** `undefined` while storage has not answered. */
  snapshot: (): boolean | undefined => required,
};
