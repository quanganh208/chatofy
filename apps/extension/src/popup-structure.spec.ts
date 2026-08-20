import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Keeps the popup's script and its markup describing the same page.
 *
 * `el()` throws when an id is missing, and every call runs at module top level. So
 * an id removed from the HTML while a lookup for it remains does not degrade the
 * popup — it stops the script before the first line of it runs, leaving a blank
 * panel with no header, no settings, no Start, and nothing on screen or in the
 * console that a user could report. The e2e run opens this page but never asserts
 * that it rendered, so that failure passes every gate there is.
 *
 * This is the gate for the whole class, not for one id: any future lookup and any
 * future removal are checked against each other here.
 */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const HTML = read('../entrypoints/popup/index.html');

/**
 * Comments stripped first. A lookup that has been commented out is not a lookup,
 * and prose naming an id that was deliberately removed is not a reference to it.
 */
const MAIN = read('../entrypoints/popup/main.ts')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const LOOKED_UP = [...MAIN.matchAll(/\bel<[^>]*>\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
const DECLARED = new Set([...HTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

describe('popup markup and script', () => {
  /**
   * A floor before the comparison, because the comparison is vacuous without one:
   * "every id looked up exists" is true of an empty list, and the list empties the
   * moment anyone renames `el`, wraps it, or switches to a template literal. That
   * is the same shape of silent pass this file exists to close.
   */
  it('finds the lookups it is meant to check', () => {
    expect(LOOKED_UP.length).toBeGreaterThan(20);
    expect(DECLARED.size).toBeGreaterThan(20);
  });

  it('declares every id the script looks up', () => {
    const missing = LOOKED_UP.filter((id) => !DECLARED.has(id));
    expect(missing).toEqual([]);
  });

  /**
   * The footer sits outside the scrolling region, so the primary action does not
   * scroll away with the settings above it. Nesting it into `main` is the easy
   * accident when the settings pane is rearranged.
   */
  it('keeps the footer a direct child of body, after main', () => {
    const body = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>'));
    const withoutMain = body.replace(/<main[\s\S]*<\/main>/, '<!--main-->');
    expect(withoutMain).toMatch(/<!--main-->[\s\S]*<footer/);
  });
});
