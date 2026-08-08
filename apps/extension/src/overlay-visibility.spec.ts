import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OVERLAY_VISIBILITY,
  overlayShownOn,
  visibleOverlayPart,
  withSiteShown,
  type OverlayVisibility,
} from './overlay-visibility';

describe('overlayShownOn', () => {
  it('shows the overlay by default', () => {
    expect(overlayShownOn(DEFAULT_OVERLAY_VISIBILITY, 'meet.google.com')).toBe(true);
  });

  it('hides it everywhere when the global switch is off', () => {
    const off: OverlayVisibility = { enabled: false, disabledSites: [] };
    expect(overlayShownOn(off, 'meet.google.com')).toBe(false);
    expect(overlayShownOn(off, 'zoom.us')).toBe(false);
    expect(overlayShownOn(off, undefined)).toBe(false);
  });

  it('hides it on a disabled platform and nowhere else', () => {
    const visibility: OverlayVisibility = { enabled: true, disabledSites: ['facebook.com'] };
    expect(overlayShownOn(visibility, 'facebook.com')).toBe(false);
    expect(overlayShownOn(visibility, 'meet.google.com')).toBe(true);
  });

  // A URL that did not resolve to a platform is a parse oddity, not a place the
  // user chose to be. Defaulting to hidden would make the overlay vanish for a
  // reason nothing on screen could explain.
  it('shows it when the platform could not be identified', () => {
    expect(overlayShownOn({ enabled: true, disabledSites: ['zoom.us'] }, undefined)).toBe(true);
  });
});

describe('withSiteShown', () => {
  it('adds and removes without duplicating', () => {
    let visibility = DEFAULT_OVERLAY_VISIBILITY;
    visibility = withSiteShown(visibility, 'zoom.us', false);
    visibility = withSiteShown(visibility, 'zoom.us', false);
    expect(visibility.disabledSites).toEqual(['zoom.us']);
    visibility = withSiteShown(visibility, 'zoom.us', true);
    expect(visibility.disabledSites).toEqual([]);
  });

  it('leaves the global switch alone', () => {
    const visibility = withSiteShown({ enabled: false, disabledSites: [] }, 'zoom.us', false);
    expect(visibility.enabled).toBe(false);
  });
});

describe('visibleOverlayPart', () => {
  it('collapses to the pill by default, so an unused install shows almost nothing', () => {
    expect(visibleOverlayPart({ capturing: false, wanted: true, expanded: false })).toBe('pill');
  });

  it('shows the panel once expanded', () => {
    expect(visibleOverlayPart({ capturing: false, wanted: true, expanded: true })).toBe('panel');
  });

  it('shows nothing at all when the user turned the overlay off', () => {
    expect(visibleOverlayPart({ capturing: false, wanted: false, expanded: false })).toBe('none');
    expect(visibleOverlayPart({ capturing: false, wanted: false, expanded: true })).toBe('none');
  });

  /**
   * The invariant the rest of the overlay is built around: everyone in the
   * meeting is being recorded and only the person running the extension knows.
   * No preference and no collapse may take that off screen.
   */
  it('never hides anything while capture is running', () => {
    for (const wanted of [true, false]) {
      for (const expanded of [true, false]) {
        expect(visibleOverlayPart({ capturing: true, wanted, expanded })).not.toBe('none');
      }
    }
  });
});
