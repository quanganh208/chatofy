import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as root from './index.js';
import { color, colorLight, palettes } from './index.js';

/**
 * What the root export is allowed to be.
 *
 * Every other surface in this repo can afford a dependency. This one cannot:
 * Metro imports it directly for `apps/mobile`, and the overlay interpolates it
 * into a string that must contain no custom properties. Those two constraints
 * were prose in the README and enforced by nothing, which was survivable while
 * the package held only data — and stops being survivable the moment a sibling
 * entry point starts importing React.
 *
 * The tests below are about the ROOT entry specifically. `@chatofy/ui/react` is
 * allowed everything this file forbids; it is simply never resolved by Metro.
 */

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

describe('@chatofy/ui root export', () => {
  it('pulls in nothing at runtime', () => {
    // Read rather than resolved: asserting on the import graph would need a
    // bundler, while the rule is simply that these files import each other and
    // nothing else. A relative import is fine; a bare specifier is a dependency.
    const files = readdirSync(here('.')).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
    );
    expect(files.length).toBeGreaterThan(0);

    const bare: string[] = [];
    for (const file of files) {
      const source = readFileSync(here(file), 'utf8');
      for (const [, specifier] of source.matchAll(
        /^\s*(?:import|export)[^'"]*from\s+'([^']+)'/gm,
      )) {
        if (specifier && !specifier.startsWith('.') && !specifier.startsWith('node:')) {
          bare.push(`${file} -> ${specifier}`);
        }
      }
    }
    expect(bare).toEqual([]);
  });

  it('exposes no function, class or component', () => {
    // Data only. A helper here is a helper Metro has to parse and React Native
    // has to survive; anything callable belongs behind the `/react` subpath or
    // in the app that needs it.
    const callable = Object.entries(root)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name);
    expect(callable).toEqual([]);
  });

  /**
   * Hex, because React Native's colour parser is the binding constraint — it
   * does not accept `oklch()`, and the failure is a silent black rather than a
   * throw. `light-dark()` is equally out: the two palettes are separate objects
   * precisely so the surface that cannot express a scheme still gets one.
   */
  it('gives every colour a literal hex, in both palettes', () => {
    const hex = /^#[0-9a-f]{6}$/i;
    for (const [scheme, palette] of Object.entries(palettes)) {
      for (const [token, value] of Object.entries(palette)) {
        expect(value, `${scheme}.${token}`).toMatch(hex);
      }
    }
    // A floor: the loop above passes on an empty palette.
    expect(Object.keys(color).length).toBeGreaterThan(20);
    expect(Object.keys(colorLight)).toEqual(Object.keys(color));
  });
});
