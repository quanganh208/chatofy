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
    // Nineteen of each today. The floor sits well under that so removing a control
    // does not read as a broken regex, and well over zero so a broken regex does
    // not read as a clean page.
    expect(LOOKED_UP.length).toBeGreaterThan(12);
    expect(DECLARED.size).toBeGreaterThan(12);
  });

  it('declares every id the script looks up', () => {
    const missing = LOOKED_UP.filter((id) => !DECLARED.has(id));
    expect(missing).toEqual([]);
  });

  /**
   * The instruments are gone from the product surface.
   *
   * Mode picked between two backends, of which one was an experiment; Server was
   * the only way to point the extension at an unreachable host; Report timings
   * collected measurements for a comparison nobody installing this is running. The
   * flag behind the last one is deliberately kept — the worker and the realtime
   * client still read it — so this asserts the absence of the control, not of the
   * capability.
   */
  it('offers none of the experiment controls', () => {
    for (const id of ['mode', 'mode-note', 'api', 'metrics']) {
      expect(DECLARED.has(id)).toBe(false);
    }
    expect(HTML).not.toContain('<details');
  });

  /**
   * One label at the top level of the settings pane, and the rest inside a group.
   *
   * The count is the cheap half. It is satisfied by wrapping the same four labels
   * in a div and changing nothing about how they read, which is precisely the
   * complaint — so the styling assertion below is the half that matters, and the
   * screenshots are the half neither can make.
   */
  it('keeps one top-level label in the settings pane', () => {
    const main = HTML.slice(HTML.indexOf('<main'), HTML.indexOf('</main>'));
    const outsideGroups = main.replace(/<fieldset[\s\S]*?<\/fieldset>/g, '');
    expect(outsideGroups.match(/<label/g) ?? []).toHaveLength(1);
    // Two groups, each named. "Runs on" used to be a label pointing at no control,
    // which reaches a screen reader as a stray phrase between two checkboxes.
    expect(main.match(/<legend>/g) ?? []).toHaveLength(2);
  });

  /**
   * Every label names a control. The one that did not was the region heading above
   * the platform list, which is now a legend.
   */
  it('gives every label a control to name', () => {
    const labels = HTML.match(/<label(?![^>]*\bfor=)[^>]*>/g) ?? [];
    expect(labels).toEqual([]);
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
