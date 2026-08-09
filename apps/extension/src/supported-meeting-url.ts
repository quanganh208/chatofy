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

/**
 * The three platforms, as the key a per-site preference is stored under.
 *
 * Not the origin. Zoom hands out a numbered host per account — `us02web.zoom.us`,
 * `us05web.zoom.us` — so "turn Chatofy off on Zoom" stored by origin would come
 * back on the first time a meeting landed on a different one. These keys are also
 * what the popup shows, which is why they read as names rather than as ids.
 */
export type MeetingSite = 'meet.google.com' | 'zoom.us' | 'facebook.com';

/**
 * Which platform a URL belongs to, or nothing.
 *
 * Deliberately looser than {@link supportOf}: a Zoom URL that is not the web
 * client still belongs to Zoom, and someone who turned the overlay off there
 * meant the platform, not the one path that can be captured.
 */
export function meetingSiteOf(url: string | undefined): MeetingSite | undefined {
  if (!url) return undefined;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return undefined;
  }
  if (host === 'meet.google.com') return 'meet.google.com';
  if (host === 'zoom.us' || host.endsWith('.zoom.us')) return 'zoom.us';
  if (host === 'facebook.com' || host.endsWith('.facebook.com')) return 'facebook.com';
  return undefined;
}

/**
 * The three platforms, in the words the popup shows when it is on none of them.
 *
 * A list rather than the sentence this used to be. "Chatofy works on Google Meet,
 * Zoom web, and Facebook calls" is three facts punctuated as one, and the two
 * qualifications that actually matter — that Zoom means the web client, that
 * Facebook includes Messenger — were the parts a reader skimmed past. Rows carry
 * them; a sentence buries them.
 *
 * Beside the patterns on purpose. These are the same three entries said in prose,
 * and a list that drifts from what the extension actually matches is worse than
 * no list — `supported-meeting-url.spec.ts` holds the two to the same length.
 */
export const SUPPORTED_MEETINGS = [
  {
    site: 'meet.google.com',
    name: 'Google Meet',
    detail: 'meet.google.com',
    pattern: 'https://meet.google.com/*',
  },
  {
    site: 'zoom.us',
    name: 'Zoom',
    detail: 'the web client — not the desktop app',
    pattern: 'https://*.zoom.us/wc/*',
  },
  {
    site: 'facebook.com',
    name: 'Facebook',
    detail: 'Messenger and group calls',
    pattern: 'https://*.facebook.com/groupcall/*',
  },
] as const satisfies ReadonlyArray<{
  site: MeetingSite;
  name: string;
  detail: string;
  /** Must be one of {@link MEETING_URL_PATTERNS}; the spec holds the two equal. */
  pattern: (typeof MEETING_URL_PATTERNS)[number];
}>;

/**
 * The match patterns for the platforms currently switched on.
 *
 * Chrome rejects an empty `documentUrlPatterns` by ignoring the restriction
 * entirely, so everything-off has to resolve to a pattern that matches nothing
 * rather than to no pattern at all — otherwise switching Chatofy off everywhere
 * would put its context-menu item on every page in the browser.
 */
export function enabledMeetingPatterns(isEnabled: (site: MeetingSite) => boolean): string[] {
  const patterns = SUPPORTED_MEETINGS.filter((meeting) => isEnabled(meeting.site)).map(
    (meeting) => meeting.pattern as string,
  );
  return patterns.length > 0 ? patterns : ['https://chatofy.invalid/*'];
}

/** The display name for a platform, for a caller that has only the key. */
export function meetingSiteName(site: MeetingSite): string {
  return SUPPORTED_MEETINGS.find((meeting) => meeting.site === site)?.name ?? site;
}

export interface MeetingSupport {
  ok: boolean;
  /** Why not, in words meant for the person looking at the popup or the overlay. */
  message?: string;
  /**
   * How loudly to say it.
   *
   * `info` is the ordinary case — this tab is simply not a meeting, which is true
   * of most tabs and is not a fault. `action` means the user is one step away and
   * the step is nameable: join Zoom from the browser instead of the app.
   *
   * Its own field because the popup used to paint every one of these on the
   * live-red notice background, so "Chatofy works on Google Meet, Zoom web, and
   * Facebook calls" arrived looking like a failure. Severity is the caller's to
   * render, but it is this function's to decide — it is the only thing that knows
   * which case it is in.
   */
  kind?: 'info' | 'action';
}

export function supportOf(url: string | undefined): MeetingSupport {
  if (!url) {
    return { ok: false, message: 'Open a meeting tab first.', kind: 'info' };
  }
  if (/^https:\/\/([^.]+\.)*zoom\.us\//.test(url) && !url.includes('/wc/')) {
    // Named explicitly rather than left to fail. A tab that is not the web client
    // cannot be captured, and without this the extension would appear to do nothing
    // for a reason nobody could guess.
    return {
      ok: false,
      kind: 'action',
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
    // Names what is true of this tab, and lets `SUPPORTED_MEETINGS` name the way
    // out. The sentence this replaced listed the three platforms inline, which
    // made the notice a paragraph to read rather than a place to look.
    return { ok: false, kind: 'info', message: 'This tab is not a meeting.' };
  }
  return { ok: true };
}
