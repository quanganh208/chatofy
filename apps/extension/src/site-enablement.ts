import type { MeetingSite } from './supported-meeting-url';

/**
 * Which meeting platforms Chatofy runs on at all.
 *
 * This started life as a preference about whether the overlay was DRAWN, which
 * turned out to be the wrong thing to offer. Someone who says "not on Meet"
 * means the extension should not act there — and hiding a panel while the
 * keyboard shortcut still starts a recording on that exact page is close to the
 * opposite of what they asked for. Off now means off: no overlay, no context
 * menu entry, and the worker refuses to capture.
 *
 * Two levels, because they answer different questions. `enabled` is "I do not
 * want this running anywhere"; `disabledSites` is "not on this platform" — the
 * common case being a work Meet where translation is wanted and a personal
 * Messenger call where it is not.
 *
 * **Neither can take down a recording indicator.** A capture already running on a
 * platform that is then switched off is STOPPED by the worker, and the overlay
 * stays mounted until the render saying so arrives. The alternative — unmounting
 * first — would leave a meeting being recorded with nothing on screen saying so,
 * for as long as the two contexts took to agree. See {@link mayUnmountOverlay}.
 *
 * Its own storage key and its own module, apart from `settings.ts`, for two
 * reasons. The content script reads this on every meeting page and must not pull
 * `@chatofy/types` into that bundle, which `settings.ts` does. And this is not a
 * capture setting: bundling it would send it through the worker's `settings`
 * message, which reopens a running capture — restarting a translation because
 * someone changed where the extension is allowed to run.
 */

const SITE_ENABLEMENT_KEY = 'chatofy.sites';

export interface SiteEnablement {
  /** Run on meeting pages at all. */
  enabled: boolean;
  /** Platforms it is off for, by `MeetingSite` key. Ignored when `enabled` is false. */
  disabledSites: MeetingSite[];
}

/** On, everywhere. Someone who installed a meeting translator expects one. */
export const DEFAULT_SITE_ENABLEMENT: SiteEnablement = {
  enabled: true,
  disabledSites: [],
};

/**
 * Whether Chatofy runs on a platform.
 *
 * Kept pure so the popup, the content script and the service worker answer the
 * same question the same way — three contexts that cannot share state and would
 * otherwise each grow their own version of this.
 *
 * An unrecognised site resolves to enabled. The three callers only ever ask
 * about the platforms the extension matches, so `undefined` means the URL parsed
 * oddly rather than that the user is somewhere unexpected, and defaulting to off
 * would disable the extension for a reason nothing on screen could explain.
 */
export function runsOn(enablement: SiteEnablement, site: MeetingSite | undefined): boolean {
  if (!enablement.enabled) return false;
  if (!site) return true;
  return !enablement.disabledSites.includes(site);
}

/**
 * Whether the overlay may be taken off a page right now.
 *
 * The mount-level half of the rule that everyone in a meeting is being recorded
 * and only the person running the extension knows. Switching a platform off
 * while a capture is running on it must not remove the indicator: the worker
 * stops that capture, and only the render reporting it stopped releases this.
 *
 * `capturing` therefore vetoes, and there is no argument that overrides it.
 */
export function mayUnmountOverlay(input: { capturing: boolean; runsHere: boolean }): boolean {
  if (input.capturing) return false;
  return !input.runsHere;
}

/**
 * Which of the overlay's two surfaces is showing, once it is mounted.
 *
 * Separate from {@link mayUnmountOverlay} because they are different questions:
 * this one is collapsed-versus-open, that one is present-versus-gone.
 *
 * `capturing` deliberately does NOT appear below. It is tempting to make it force
 * the panel — that reads like the safe direction — but it silently disables the
 * collapse control for the whole of a recording, which is the one time someone is
 * most likely to want the overlay out of the way. The invariant is that there is
 * always a surface, not that the surface is always the panel: collapsing during a
 * capture gives the pill, and the pill in that state is red, pulsing and labelled
 * "Recording" (`.pill.live` in `overlay-styles.ts`). Neither branch here can
 * return nothing.
 *
 * Capture starting still opens the panel by itself — `Overlay.render` sets
 * `expanded` on the transition, which is a different rule from this one and is
 * about what the user just asked for rather than about what may be hidden.
 */
export function visibleOverlayPart(input: {
  capturing: boolean;
  expanded: boolean;
}): 'panel' | 'pill' {
  return input.expanded ? 'panel' : 'pill';
}

/** `disabledSites` with one platform added or removed, without duplicates. */
export function withSiteEnabled(
  enablement: SiteEnablement,
  site: MeetingSite,
  enabled: boolean,
): SiteEnablement {
  const without = enablement.disabledSites.filter((entry) => entry !== site);
  return {
    ...enablement,
    disabledSites: enabled ? without : [...without, site],
  };
}

/** Merged over the defaults: a value written by an older version lacks fields. */
function normalise(value: Partial<SiteEnablement> | undefined): SiteEnablement {
  return {
    ...DEFAULT_SITE_ENABLEMENT,
    ...value,
    // Guarded rather than spread: storage is JSON, and a hand-edited or truncated
    // value would otherwise reach `includes` as a non-array and throw on a page
    // that is not ours.
    disabledSites: Array.isArray(value?.disabledSites)
      ? value.disabledSites
      : DEFAULT_SITE_ENABLEMENT.disabledSites,
  };
}

export async function loadSiteEnablement(): Promise<SiteEnablement> {
  const stored = await chrome.storage.local.get(SITE_ENABLEMENT_KEY);
  return normalise(stored[SITE_ENABLEMENT_KEY] as Partial<SiteEnablement> | undefined);
}

export async function saveSiteEnablement(enablement: SiteEnablement): Promise<void> {
  await chrome.storage.local.set({ [SITE_ENABLEMENT_KEY]: enablement });
}

/**
 * Call back when the preference changes, wherever it was changed from.
 *
 * The popup, the meeting page and the worker are three contexts, and the meeting
 * page is the one that stays open. Without this, switching a platform off would
 * take effect on the call already in progress only after a reload — and
 * reloading a meeting tab drops the `activeTab` grant capture needs, so the fix
 * would cost more than the annoyance.
 */
export function watchSiteEnablement(onChange: (enablement: SiteEnablement) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes[SITE_ENABLEMENT_KEY];
    if (!change) return;
    onChange(normalise(change.newValue as Partial<SiteEnablement> | undefined));
  });
}
