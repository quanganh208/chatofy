/**
 * Whether Chrome has granted this extension the microphone, and how to ask for it.
 *
 * The manifest cannot grant it. `audioCapture` looks like the permission for this
 * and is a Chrome App one — an extension that declares it is told "only allowed
 * for packaged apps" and given nothing. There is no extension equivalent. The only
 * grant that exists is the one a user hands to Chrome's own prompt.
 *
 * The offscreen document, which is where every microphone in this extension is
 * actually opened, cannot raise that prompt: it has no window, so
 * `getUserMedia({ audio })` there is refused outright rather than asked about. What
 * it does inherit is the answer, because Chrome stores the grant against the
 * `chrome-extension://<id>` origin and every page of this extension shares it. So
 * the prompt is raised once by a page that has a window, and the offscreen document
 * reuses that grant for every meeting afterwards.
 *
 * That page is a TAB, never the popup. A popup closes the moment it loses focus and
 * Chrome's prompt takes focus, so asking from there dismisses the question instead
 * of answering it.
 */

/** The page that raises the prompt. Built from `entrypoints/microphone/`. */
const PERMISSION_PAGE = 'microphone.html';

/**
 * What to say when the microphone was refused, wherever that surfaces.
 *
 * One string because two surfaces report it — the popup before a capture starts and
 * the overlay when one fails mid-meeting — and a user who reads both should not have
 * to work out that they describe the same missing grant.
 */
export const MICROPHONE_BLOCKED =
  'Chrome has not given Chatofy your microphone. Open the Chatofy popup and choose “Allow microphone”.';

/**
 * Ask Chrome, from any extension page.
 *
 * Not callable from the service worker, which has no `navigator.permissions`; the
 * popup is the surface that needs the answer anyway, since it is the only one that
 * can act on it.
 */
export async function microphonePermission(): Promise<PermissionState> {
  try {
    const status = await navigator.permissions.query({
      // Not in the DOM typings' `PermissionName` union, though Chrome has
      // supported it for years.
      name: 'microphone',
    });
    return status.state;
  } catch {
    // A context that will not answer the query. `prompt` is the safe read: it
    // offers the grant page to someone who may already have granted it, costing a
    // click, where `granted` would hide the only route to fixing a microphone that
    // never opens.
    return 'prompt';
  }
}

/** Open the grant page in a focused tab. */
export async function openMicrophonePermissionPage(): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL(PERMISSION_PAGE), active: true });
}
