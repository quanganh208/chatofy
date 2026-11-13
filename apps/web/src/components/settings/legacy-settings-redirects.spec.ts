import { describe, expect, it } from 'vitest';
import { LEGACY_SETTINGS_REDIRECTS } from './legacy-settings-redirects';
import { readSettingsDialog } from './settings-dialog-url';
import { SETTINGS_TAB_IDS } from './settings-tab-ids';

/**
 * The retired settings routes answer with redirects to the Settings dialog on the tab
 * that now holds what each page held.
 *
 * This holds the table: every old address is listed, every destination opens a tab
 * that exists over `/translate/one-way`, none is permanent, and — under the model of
 * Next's query merge below, which is Next's behaviour and not proven here — a Polar
 * return keeps the query Billing reads.
 */
const destinationOf = (source: string) =>
  LEGACY_SETTINGS_REDIRECTS.find((rule) => rule.source === source)?.destination;

/**
 * What Next does with a config redirect's query: the request's parameters are carried
 * over and merged under the destination's own. Modelled here so the Polar return can
 * be asserted end to end against the table.
 */
function follow(request: string): string | undefined {
  const url = new URL(request, 'https://chatofy.test');
  const destination = destinationOf(url.pathname);
  if (!destination) return undefined;
  const target = new URL(destination, url.origin);
  const merged = new URLSearchParams(url.search);
  for (const [key, value] of target.searchParams) merged.set(key, value);
  return `${target.pathname}?${merged.toString()}`;
}

describe('legacy settings redirects', () => {
  it.each([
    ['/settings', 'general'],
    ['/settings/appearance', 'general'],
    ['/settings/audio', 'translation'],
    ['/settings/defaults', 'translation'],
    ['/settings/ai-context', 'ai-context'],
    ['/settings/profile', 'account'],
    ['/settings/security', 'account'],
    ['/settings/billing', 'billing'],
    ['/account', 'billing'],
    ['/preferences', 'general'],
  ])('sends %s to the %s tab over /translate/one-way', (source, tab) => {
    expect(destinationOf(source)).toBe(`/translate/one-way?settings=${tab}`);
  });

  it('opens a tab that exists from every rule, and lists each source once', () => {
    const sources = LEGACY_SETTINGS_REDIRECTS.map((rule) => rule.source);
    expect(new Set(sources).size).toBe(sources.length);
    for (const rule of LEGACY_SETTINGS_REDIRECTS) {
      const view = readSettingsDialog(
        new URL(rule.destination, 'https://chatofy.test').searchParams,
      );
      expect(SETTINGS_TAB_IDS).toContain(view);
    }
  });

  it('answers every old address temporarily (307), so no browser caches the answer', () => {
    for (const rule of LEGACY_SETTINGS_REDIRECTS) expect(rule.permanent).toBe(false);
  });

  it("keeps Polar's checkout return, so Billing still reads it", () => {
    expect(follow('/settings/billing?checkout=done')).toBe(
      '/translate/one-way?checkout=done&settings=billing',
    );
    expect(follow('/account?checkout=done&x=1')).toBe(
      '/translate/one-way?checkout=done&x=1&settings=billing',
    );
  });
});
