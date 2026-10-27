/**
 * Web and mobile say a shared string through ONE key, under `common.*`.
 *
 * Each app once kept its own copy of the meeting vocabulary, and the copies
 * drifted: the conference language picker read "Tiếng Việt" in the English
 * interface on web and "English" in the Vietnamese one on mobile, and the empty
 * chat said two different things in Vietnamese. Nothing compared the copies, so
 * this does.
 */
import { describe, expect, it } from 'vitest';
import { en, type MessageKey } from './en.js';
import { vi } from './vi.js';

/**
 * `web.X` / `mobile.X` pairs that are worded for their platform on purpose. Each
 * entry is the shared `X`; say why beside it.
 */
const PLATFORM_WORDED = new Set<string>([
  // A browser's site settings and a reload, against the phone's Settings app.
  'conference.permissionDeniedHint',
]);

const keys = Object.keys(en) as MessageKey[];
const surface = (prefix: 'web.' | 'mobile.') => keys.filter((k) => k.startsWith(prefix));

describe('strings shared by web and mobile', () => {
  it('have no web.X / mobile.X twin', () => {
    const twins = surface('web.')
      .map((k) => k.slice('web.'.length))
      .filter((rest) => `mobile.${rest}` in en && !PLATFORM_WORDED.has(rest));
    expect(twins).toEqual([]);
  });

  it('are not written out twice under different web and mobile keys', () => {
    const webByText = new Map<string, MessageKey>();
    for (const k of surface('web.')) webByText.set(`${en[k]}\u0000${vi[k]}`, k);
    const copies = surface('mobile.')
      .map((k) => [webByText.get(`${en[k]}\u0000${vi[k]}`), k] as const)
      .filter(([web]) => web !== undefined);
    expect(copies).toEqual([]);
  });

  it('keep every platform-worded entry pointing at a pair that still exists', () => {
    for (const rest of PLATFORM_WORDED) {
      expect(`web.${rest}` in en && `mobile.${rest}` in en, rest).toBe(true);
    }
  });
});
