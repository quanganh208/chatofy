/**
 * Which tabs this extension can capture, and why the others cannot.
 *
 * The popup asks this to decide whether to show its controls; the service worker
 * asks it before acting on a keyboard shortcut or a context-menu click, which can
 * arrive from any tab in any window. Two answers to the same question drift, and
 * the failure is quiet: a tab one side accepts and the other refuses is a capture
 * that starts with no overlay to show it, or an overlay that never gets a stream.
 *
 * The list here is duplicated by necessity in two static places — `host_permissions`
 * and the content script's `matches`, both in files a bundler reads rather than a
 * runtime does. Adding a site means editing all three. There is no abstraction that
 * removes that without generating the manifest, which costs more than it saves.
 */

/** Where the overlay and the capture stream can both exist. */
export const MEETING_URL_PATTERNS = [
  'https://meet.google.com/*',
  'https://*.zoom.us/wc/*',
  'https://*.facebook.com/groupcall/*',
] as const;

export interface MeetingSupport {
  ok: boolean;
  /** Why not, in words meant for the person looking at the popup or the overlay. */
  message?: string;
}

export function supportOf(url: string | undefined): MeetingSupport {
  if (!url) {
    return { ok: false, message: 'Open a meeting tab first.' };
  }
  if (/^https:\/\/([^.]+\.)*zoom\.us\//.test(url) && !url.includes('/wc/')) {
    // Named explicitly rather than left to fail. A tab that is not the web client
    // cannot be captured, and without this the extension would appear to do nothing
    // for a reason nobody could guess.
    return {
      ok: false,
      message:
        'This looks like Zoom, but not the web client. The Zoom desktop app is not a ' +
        'browser tab, so its audio cannot be captured. Join from “Join from your ' +
        'browser” instead.',
    };
  }
  const supported =
    /^https:\/\/meet\.google\.com\//.test(url) ||
    /^https:\/\/([^.]+\.)*zoom\.us\/wc\//.test(url) ||
    // A Messenger call started from a Facebook thread runs here. Facebook opens it
    // in a window with no toolbar, which is why the worker needs this answer at all:
    // there is no extension icon in that window to click.
    /^https:\/\/([^.]+\.)*facebook\.com\/groupcall\//.test(url);
  if (!supported) {
    return {
      ok: false,
      message: 'Chatofy works on Google Meet, Zoom web, and Facebook calls.',
    };
  }
  return { ok: true };
}
