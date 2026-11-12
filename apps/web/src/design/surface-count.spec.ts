// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { elevatedSurfaces } from './surface-count';

afterEach(() => {
  document.body.innerHTML = '';
});

const count = (html: string) => {
  document.body.innerHTML = html;
  return elevatedSurfaces(document.body).length;
};

describe('elevatedSurfaces', () => {
  it('counts a card and the two surface shadows', () => {
    expect(count('<div data-slot="card"></div>')).toBe(1);
    expect(count('<div class="shadow-elev-md"></div><div class="shadow-elev-lg"></div>')).toBe(2);
  });

  it('counts a shadow carrying the important modifier, as the toast does', () => {
    expect(count('<li data-sonner-toast class="text-body! shadow-elev-lg! gap-3!"></li>')).toBe(1);
  });

  it('ignores a control depth and a shadow that only applies on hover', () => {
    expect(count('<button class="shadow-elev-sm hover:shadow-elev-md"></button>')).toBe(0);
    expect(count('<button class="shadow-elev-sm!"></button>')).toBe(0);
  });
});
