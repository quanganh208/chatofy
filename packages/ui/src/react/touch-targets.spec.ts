import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Controls reach 44px under a touch pointer.
 *
 * Measured on /preferences at 375px with touch emulation: buttons 36-40px, selects and
 * inputs 40px, switches 32x18, segment buttons 33px. WCAG 2.2 AA asks for 24px, which
 * these pass; 44px is the platform guidance and the bar this redesign set. Everything is
 * under `pointer-coarse:` so a mouse keeps the compact desktop sizing, and a switch grows
 * its hit area with a pseudo-element so the drawn switch does not change.
 *
 * Class-text spec: happy-dom has no box model. The touch-emulated measurement in the
 * redesign report is the real check.
 */
const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8');

describe('44px touch targets', () => {
  it('Button: every size grows under a touch pointer', () => {
    const src = read('button.tsx');
    expect(src).toContain('pointer-coarse:h-11');
    expect(src).toContain('pointer-coarse:size-11');
    expect(src.match(/pointer-coarse:h-11/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('Input grows under a touch pointer', () => {
    expect(read('input.tsx')).toContain('pointer-coarse:h-11');
  });

  it('Select trigger grows under a touch pointer, in both sizes', () => {
    const src = read('select.tsx');
    expect(src).toContain('pointer-coarse:data-[size=default]:h-11');
    expect(src).toContain('pointer-coarse:data-[size=sm]:h-11');
  });

  it('Segmented control items grow under a touch pointer', () => {
    expect(read('segmented-control.tsx')).toContain('pointer-coarse:min-h-11');
  });

  it('Toggle grows under a touch pointer', () => {
    expect(read('toggle.tsx')).toContain('pointer-coarse:min-h-11');
  });

  it('Switch widens its hit area without changing the drawn switch', () => {
    const src = read('switch.tsx');
    expect(src).toContain('after:absolute');
    expect(src).toContain('after:-inset-y-3.5');
    expect(src).toContain('after:-inset-x-2');
  });
});
