import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SITE_ENABLEMENT,
  mayUnmountOverlay,
  runsOn,
  visibleOverlayPart,
  withSiteEnabled,
  type SiteEnablement,
} from './site-enablement';

describe('runsOn', () => {
  it('runs everywhere by default', () => {
    expect(runsOn(DEFAULT_SITE_ENABLEMENT, 'meet.google.com')).toBe(true);
  });

  it('runs nowhere when the master switch is off', () => {
    const off: SiteEnablement = { enabled: false, disabledSites: [] };
    expect(runsOn(off, 'meet.google.com')).toBe(false);
    expect(runsOn(off, 'zoom.us')).toBe(false);
    expect(runsOn(off, undefined)).toBe(false);
  });

  it('stops on a disabled platform and nowhere else', () => {
    const enablement: SiteEnablement = { enabled: true, disabledSites: ['facebook.com'] };
    expect(runsOn(enablement, 'facebook.com')).toBe(false);
    expect(runsOn(enablement, 'meet.google.com')).toBe(true);
  });

  // A URL that did not resolve to a platform is a parse oddity, not a place the
  // user chose to be. Defaulting to off would disable the extension for a reason
  // nothing on screen could explain.
  it('runs when the platform could not be identified', () => {
    expect(runsOn({ enabled: true, disabledSites: ['zoom.us'] }, undefined)).toBe(true);
  });
});

describe('withSiteEnabled', () => {
  it('adds and removes without duplicating', () => {
    let enablement = DEFAULT_SITE_ENABLEMENT;
    enablement = withSiteEnabled(enablement, 'zoom.us', false);
    enablement = withSiteEnabled(enablement, 'zoom.us', false);
    expect(enablement.disabledSites).toEqual(['zoom.us']);
    enablement = withSiteEnabled(enablement, 'zoom.us', true);
    expect(enablement.disabledSites).toEqual([]);
  });

  it('leaves the master switch alone', () => {
    const enablement = withSiteEnabled({ enabled: false, disabledSites: [] }, 'zoom.us', false);
    expect(enablement.enabled).toBe(false);
  });
});

describe('mayUnmountOverlay', () => {
  it('takes the overlay off a platform that is switched off', () => {
    expect(mayUnmountOverlay({ capturing: false, runsHere: false })).toBe(true);
  });

  it('leaves it alone where Chatofy runs', () => {
    expect(mayUnmountOverlay({ capturing: false, runsHere: true })).toBe(false);
  });

  /**
   * The invariant the rest of the overlay is built around: everyone in the
   * meeting is being recorded and only the person running the extension knows.
   * Switching a platform off does not get to take that off screen — the worker
   * stops the capture, and only the render reporting it stopped releases this.
   * Unmounting first would leave a live recording with nothing saying so for as
   * long as the two contexts took to agree.
   */
  it('never unmounts while a capture is running, whatever the preference says', () => {
    for (const runsHere of [true, false]) {
      expect(mayUnmountOverlay({ capturing: true, runsHere })).toBe(false);
    }
  });
});

describe('visibleOverlayPart', () => {
  it('collapses to the pill by default, so an unused install shows almost nothing', () => {
    expect(visibleOverlayPart({ capturing: false, expanded: false })).toBe('pill');
  });

  it('shows the panel once expanded', () => {
    expect(visibleOverlayPart({ capturing: false, expanded: true })).toBe('panel');
  });

  // Collapsing during a capture gives the red pulsing pill, never nothing.
  it('always shows something while capture is running', () => {
    for (const expanded of [true, false]) {
      expect(visibleOverlayPart({ capturing: true, expanded })).toBeTruthy();
    }
  });
});
