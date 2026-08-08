import type { MeetingSite } from './supported-meeting-url';

/**
 * Whether the user wants to see Chatofy on a meeting page at all.
 *
 * This exists because installing the extension used to be the same act as
 * agreeing to a 340px panel over the corner of every Meet, Zoom and Messenger
 * call, forever, whether or not it was ever used. There was no way to say no
 * short of disabling the extension in `chrome://extensions`.
 *
 * Two levels, because they answer different questions. `enabled` is "I do not
 * want this on screen"; `disabledSites` is "not on this platform" — the common
 * case being a work Meet where the overlay is wanted and a personal Messenger
 * call where it is not.
 *
 * **This preference governs the IDLE surface only.** It cannot hide the fact
 * that a meeting is being recorded: while capture runs, the indicator appears
 * regardless of anything stored here. See `entrypoints/content/overlay.ts`.
 *
 * Its own storage key and its own module, apart from `settings.ts`, for two
 * reasons. The content script reads this on every meeting page and must not pull
 * `@chatofy/types` into that bundle, which `settings.ts` does. And a preference
 * about whether a surface is drawn is not a capture setting: bundling them would
 * send it through the worker's `settings` message, which reopens a running
 * capture — restarting a translation because someone collapsed a panel.
 */

export const OVERLAY_VISIBILITY_KEY = 'chatofy.overlayVisibility';

export interface OverlayVisibility {
  /** Draw the idle overlay on meeting pages at all. */
  enabled: boolean;
  /** Platforms it is off for, by `MeetingSite` key. Ignored when `enabled` is false. */
  disabledSites: MeetingSite[];
}

/** On, everywhere. Someone who installed a meeting overlay expects to see one. */
export const DEFAULT_OVERLAY_VISIBILITY: OverlayVisibility = {
  enabled: true,
  disabledSites: [],
};

/**
 * The resolver, kept pure so both the popup and the content script answer the
 * same question the same way — and so it can be tested without a browser.
 *
 * An unrecognised site resolves to visible. The content script only runs on the
 * three matched platforms, so `undefined` here means the URL parsed oddly rather
 * than that the user is somewhere unexpected, and defaulting to hidden would
 * make the overlay disappear for a reason nobody could see.
 */
export function overlayShownOn(
  visibility: OverlayVisibility,
  site: MeetingSite | undefined,
): boolean {
  if (!visibility.enabled) return false;
  if (!site) return true;
  return !visibility.disabledSites.includes(site);
}

/**
 * Which of the overlay's two surfaces is on screen.
 *
 * The whole visibility rule in one pure function, so the safety invariant is
 * checkable by reading six lines rather than by tracing three booleans through a
 * render method — and so a test can assert it without a DOM.
 *
 * `capturing` is the first term on purpose. **No combination of the others can
 * produce `none` while it is true.** Everyone in a meeting is being recorded and
 * only the person running the extension knows; a preference that could suppress
 * that is not a preference, it is a way to record people quietly. Collapsing
 * while capture runs yields the pill, which is red and pulses.
 */
export function visibleOverlayPart(input: {
  capturing: boolean;
  /** The resolved preference for the idle surface — see {@link overlayShownOn}. */
  wanted: boolean;
  /** Whether the user has expanded the panel on this page. */
  expanded: boolean;
}): 'panel' | 'pill' | 'none' {
  if (input.capturing) return input.expanded ? 'panel' : 'pill';
  if (!input.wanted) return 'none';
  return input.expanded ? 'panel' : 'pill';
}

/** `disabledSites` with one platform added or removed, without duplicates. */
export function withSiteShown(
  visibility: OverlayVisibility,
  site: MeetingSite,
  shown: boolean,
): OverlayVisibility {
  const without = visibility.disabledSites.filter((entry) => entry !== site);
  return {
    ...visibility,
    disabledSites: shown ? without : [...without, site],
  };
}

/** Merged over the defaults: a value written by an older version lacks fields. */
export async function loadOverlayVisibility(): Promise<OverlayVisibility> {
  const stored = await chrome.storage.local.get(OVERLAY_VISIBILITY_KEY);
  const value = stored[OVERLAY_VISIBILITY_KEY] as Partial<OverlayVisibility> | undefined;
  return {
    ...DEFAULT_OVERLAY_VISIBILITY,
    ...value,
    // Guarded rather than spread: storage is JSON and a hand-edited or truncated
    // value would otherwise reach `includes` as a non-array and throw on a page
    // that is not ours.
    disabledSites: Array.isArray(value?.disabledSites)
      ? value.disabledSites
      : DEFAULT_OVERLAY_VISIBILITY.disabledSites,
  };
}

export async function saveOverlayVisibility(visibility: OverlayVisibility): Promise<void> {
  await chrome.storage.local.set({ [OVERLAY_VISIBILITY_KEY]: visibility });
}

/**
 * Call back when the preference changes, wherever it was changed from.
 *
 * The popup and the meeting page are different contexts, and the meeting page is
 * the one that stays open. Without this, turning the overlay off would take
 * effect on the call already in progress only after a reload — and reloading a
 * meeting tab drops the `activeTab` grant that capture needs, so the fix would
 * cost more than the annoyance.
 */
export function watchOverlayVisibility(onChange: (visibility: OverlayVisibility) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes[OVERLAY_VISIBILITY_KEY];
    if (!change) return;
    const value = change.newValue as Partial<OverlayVisibility> | undefined;
    onChange({
      ...DEFAULT_OVERLAY_VISIBILITY,
      ...value,
      disabledSites: Array.isArray(value?.disabledSites)
        ? value.disabledSites
        : DEFAULT_OVERLAY_VISIBILITY.disabledSites,
    });
  });
}
