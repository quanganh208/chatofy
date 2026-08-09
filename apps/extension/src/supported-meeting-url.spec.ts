import { describe, expect, it } from 'vitest';
import {
  MEETING_URL_PATTERNS,
  SUPPORTED_MEETINGS,
  enabledMeetingPatterns,
  meetingSiteName,
  meetingSiteOf,
  supportOf,
} from './supported-meeting-url';

describe('SUPPORTED_MEETINGS', () => {
  /**
   * The popup lists these to someone who is on none of them, and the worker
   * derives the context menu's patterns from them. A list that has drifted from
   * what the extension actually matches is worse than no list: it sends a reader
   * to a platform that will not work, or withholds the menu item from one that
   * would.
   */
  it('covers exactly the URL patterns the extension matches', () => {
    expect([...SUPPORTED_MEETINGS].map((m) => m.pattern).sort()).toEqual(
      [...MEETING_URL_PATTERNS].sort(),
    );
  });

  it('gives every pattern a site key that the matcher agrees with', () => {
    for (const meeting of SUPPORTED_MEETINGS) {
      // The pattern with its wildcards made concrete — the same URL shape the
      // resolver sees at runtime.
      const url = meeting.pattern.replace('*.', 'sub.').replace(/\*$/, 'room');
      expect(meetingSiteOf(url)).toBe(meeting.site);
      expect(meetingSiteName(meeting.site)).toBe(meeting.name);
    }
  });

  it('gives every platform a name and the qualification a prose list loses', () => {
    for (const meeting of SUPPORTED_MEETINGS) {
      expect(meeting.name).not.toBe('');
      expect(meeting.detail).not.toBe('');
    }
    // The two that were buried in the sentence this replaced.
    const zoom = SUPPORTED_MEETINGS.find((m) => m.name === 'Zoom');
    expect(zoom?.detail).toMatch(/web client/i);
    const facebook = SUPPORTED_MEETINGS.find((m) => m.name === 'Facebook');
    expect(facebook?.detail).toMatch(/messenger/i);
  });
});

describe('meetingSiteOf', () => {
  it('collapses every Zoom host onto one key', () => {
    // The reason this function exists rather than storing an origin: Zoom hands
    // out a numbered host per account, so a per-site preference keyed by origin
    // would come back on the first meeting that landed on a different one.
    expect(meetingSiteOf('https://us02web.zoom.us/wc/123/join')).toBe('zoom.us');
    expect(meetingSiteOf('https://us05web.zoom.us/wc/456/join')).toBe('zoom.us');
    expect(meetingSiteOf('https://zoom.us/')).toBe('zoom.us');
  });

  it('recognises the other two platforms', () => {
    expect(meetingSiteOf('https://meet.google.com/abc-defg-hij')).toBe('meet.google.com');
    expect(meetingSiteOf('https://www.facebook.com/groupcall/ROOM:1/')).toBe('facebook.com');
  });

  // Looser than `supportOf` on purpose: someone who turned the overlay off on
  // Zoom meant Zoom, not the one path whose audio can be captured.
  it('claims a Zoom URL that is not the web client', () => {
    expect(meetingSiteOf('https://us02web.zoom.us/j/123')).toBe('zoom.us');
  });

  it('is undefined for anything else, including unparseable input', () => {
    expect(meetingSiteOf('https://example.com/')).toBeUndefined();
    expect(meetingSiteOf('not a url')).toBeUndefined();
    expect(meetingSiteOf(undefined)).toBeUndefined();
    // Suffix matching must not accept a lookalike domain.
    expect(meetingSiteOf('https://notzoom.us/wc/1')).toBeUndefined();
    expect(meetingSiteOf('https://meet.google.com.evil.test/')).toBeUndefined();
  });
});

describe('enabledMeetingPatterns', () => {
  it('drops the platforms that are switched off', () => {
    expect(enabledMeetingPatterns((site) => site !== 'zoom.us')).toEqual([
      'https://meet.google.com/*',
      'https://*.facebook.com/groupcall/*',
    ]);
  });

  /**
   * Chrome treats an empty `documentUrlPatterns` as no restriction at all, so
   * everything-off has to resolve to a pattern that matches nothing. Returning
   * `[]` would put Chatofy's context-menu item on every page in the browser at
   * the exact moment the user switched it off everywhere.
   */
  it('never returns an empty list', () => {
    const none = enabledMeetingPatterns(() => false);
    expect(none).toHaveLength(1);
    expect(none[0]).not.toMatch(/meet\.google|zoom|facebook/);
  });
});

describe('supportOf', () => {
  it('accepts the three capturable URLs', () => {
    expect(supportOf('https://meet.google.com/abc-defg-hij').ok).toBe(true);
    expect(supportOf('https://us02web.zoom.us/wc/123/join').ok).toBe(true);
    expect(supportOf('https://www.facebook.com/groupcall/ROOM:1/').ok).toBe(true);
  });

  /**
   * The severity split. An ordinary tab is not a fault and must not be reported
   * on the blocked-capture red; a Zoom desktop link is one nameable step away
   * and is worth an amber notice.
   */
  it('marks an ordinary tab as info and the Zoom desktop case as actionable', () => {
    expect(supportOf('https://example.com/').kind).toBe('info');
    expect(supportOf(undefined).kind).toBe('info');
    expect(supportOf('https://us02web.zoom.us/j/123').kind).toBe('action');
  });
});
