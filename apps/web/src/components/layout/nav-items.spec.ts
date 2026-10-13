import { describe, expect, it } from 'vitest';
import { navItemFor } from './nav-items';

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
