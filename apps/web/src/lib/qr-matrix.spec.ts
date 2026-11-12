import { describe, expect, it } from 'vitest';
import { qrMatrix } from './qr-matrix';

/**
 * The QR code that opens a meeting on a phone.
 *
 * Generation is delegated to `qrcode-generator` (MIT, no dependencies); this file only turns
 * its module grid into something a React SVG can draw. The finder-pattern check below is the
 * one fixed feature every QR symbol has in its top-left corner, so a grid that is transposed,
 * inverted or off by one fails it.
 */
const URL = 'https://chatofy.example.com/conference/cmw9ehun0005tg7kof8ai8vo';

describe('qrMatrix', () => {
  it('returns a square grid of a valid QR size', () => {
    const { size, modules } = qrMatrix(URL);
    expect(size).toBeGreaterThanOrEqual(21);
    // QR sizes are 17 + 4 * version.
    expect((size - 17) % 4).toBe(0);
    expect(modules.length).toBe(size);
    expect(modules.every((row) => row.length === size)).toBe(true);
  });

  it('draws the 7x7 finder pattern in the top-left corner', () => {
    const { modules } = qrMatrix(URL);
    const row = (r: number) =>
      modules[r]!.slice(0, 8)
        .map((m) => (m ? '#' : '.'))
        .join('');
    expect(row(0)).toBe('#######.');
    expect(row(1)).toBe('#.....#.');
    expect(row(2)).toBe('#.###.#.');
    expect(row(3)).toBe('#.###.#.');
    expect(row(4)).toBe('#.###.#.');
    expect(row(5)).toBe('#.....#.');
    expect(row(6)).toBe('#######.');
    expect(row(7)).toBe('........');
  });

  it('is deterministic and depends on the text', () => {
    expect(qrMatrix(URL).modules).toEqual(qrMatrix(URL).modules);
    expect(qrMatrix(URL + 'x').modules).not.toEqual(qrMatrix(URL).modules);
  });

  it('describes the dark modules as one SVG path of row runs', () => {
    const { path, modules } = qrMatrix(URL);
    expect(path.startsWith('M')).toBe(true);
    // One `M x y h<run> v1 h-<run> z` per run of dark modules, so it is far shorter than
    // one rectangle per module.
    const runs = path.match(/M/g)?.length ?? 0;
    const dark = modules.flat().filter(Boolean).length;
    expect(runs).toBeGreaterThan(0);
    expect(runs).toBeLessThan(dark);
  });
});
