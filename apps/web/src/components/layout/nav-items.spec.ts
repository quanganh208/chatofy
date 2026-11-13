import { describe, expect, it } from 'vitest';
import { navGroups, navItemFor, navItems, navPlaceFor, SETTINGS_ENTRY } from './nav-items';

describe('navItemFor', () => {
  it('finds the item for its own route', () => {
    expect(navItemFor('/history')?.href).toBe('/history');
  });

  it('finds the parent item for a nested route, so the page keeps a title', () => {
    expect(navItemFor('/history/580bf8eb-c0d2-4167-90e6-3964b5779c72')?.href).toBe('/history');
  });

  it('does not match a sibling that only shares a prefix', () => {
    expect(navItemFor('/historyx')).toBeUndefined();
  });

  it('matches nothing outside the product', () => {
    expect(navItemFor('/')).toBeUndefined();
  });

  it('tells the two translation pages apart', () => {
    expect(navItemFor('/translate/one-way')?.href).toBe('/translate/one-way');
    expect(navItemFor('/translate')).toBeUndefined();
    expect(navItemFor('/translate/two-way')?.href).toBe('/translate/two-way');
  });
});

describe('the conference entry', () => {
  it('is listed after the two translation pages', () => {
    expect(navItems().map((item) => item.href)).toEqual([
      '/translate/one-way',
      '/translate/two-way',
      '/conference',
      '/history',
      '/glossary',
    ]);
  });
});

describe('navPlaceFor', () => {
  it('pairs a route with its group, for the breadcrumb', () => {
    const place = navPlaceFor('/history/abc');
    expect(place?.group.labelKey).toBe('web.chrome.navGroupLibrary');
    expect(place?.item.href).toBe('/history');
  });

  it('places nothing under Settings: it is a dialog over the page, not a route', () => {
    // The retired `/settings/*` addresses only redirect now, so they have no place.
    expect(navPlaceFor('/settings/billing')).toBeUndefined();
    expect(navGroups().map((group) => group.labelKey)).not.toContain('common.nav.settings');
    expect(SETTINGS_ENTRY).not.toHaveProperty('href');
  });

  it('places nothing outside the product', () => {
    expect(navPlaceFor('/')).toBeUndefined();
  });
});
