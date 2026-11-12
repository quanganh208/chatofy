import { describe, expect, it } from 'vitest';
import { LEGACY_SETTINGS_REDIRECTS } from './legacy-settings-redirects';
import { SETTINGS_SECTIONS } from './settings-sections';

/**
 * The retired routes answer with redirects to pages that exist.
 *
 * The real 308s are checked against a running server; this holds the table: every
 * destination is a settings page, the old routes are permanent, and `/account` — a
 * bookmark, the mobile buy link or a Polar return — lands on Billing.
 */
const pages = new Set<string>(SETTINGS_SECTIONS.map((section) => section.href));
const first = (source: string, query: Record<string, string> = {}) =>
  LEGACY_SETTINGS_REDIRECTS.find(
    (rule) =>
      rule.source === source &&
      (rule.has ?? []).every((has) => has.type === 'query' && has.key in query),
  );

describe('legacy settings redirects', () => {
  it('sends every rule to a settings page that exists', () => {
    for (const rule of LEGACY_SETTINGS_REDIRECTS) expect(pages.has(rule.destination)).toBe(true);
  });

  it('moves Preferences to Appearance and Account to Billing permanently (308)', () => {
    expect(first('/preferences')).toMatchObject({
      destination: '/settings/appearance',
      permanent: true,
    });
    expect(first('/account')).toMatchObject({ destination: '/settings/billing', permanent: true });
  });

  it('lands a Polar return to /account on Billing, where the return is read', () => {
    expect(first('/account', { checkout: 'done' })).toMatchObject({
      destination: '/settings/billing',
      permanent: true,
    });
  });

  it('opens bare /settings on Appearance, temporarily', () => {
    expect(first('/settings')).toMatchObject({
      destination: '/settings/appearance',
      permanent: false,
    });
  });
});
