import { describe, expect, it } from 'vitest';
import { navItemFor, navItems } from './nav-items';

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
});

describe('the conference entry follows the build flag', () => {
  const hrefs = (enabled: boolean) => navItems(enabled).map((item) => item.href);

  it('is listed, after Translate, in a build that ships conferencing', () => {
    expect(hrefs(true)).toEqual([
      '/translate',
      '/conference',
      '/history',
      '/preferences',
      '/account',
    ]);
  });

  it('is absent in a build that does not, so no nav item leads to a 404', () => {
    expect(hrefs(false)).toEqual(['/translate', '/history', '/preferences', '/account']);
    expect(navItemFor('/conference', navItems(false))).toBeUndefined();
  });
});
