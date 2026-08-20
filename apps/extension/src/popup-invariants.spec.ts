import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The popup's non-negotiables, kept after the pane became components.
 *
 * Two specs used to stand here and both were tied to how the popup was built
 * rather than to what it must not do. `popup-style.spec.ts` parsed the
 * hand-assembled CSS template for an unterminated backtick — a real defect once,
 * and one Tailwind makes unrepresentable: there is no template literal left to
 * truncate, and the token half of what it checked moved to
 * `token-parity.spec.ts`. `popup-structure.spec.ts` compared `el('id')` lookups
 * against the ids in the markup, which mattered because every lookup ran at module
 * top level and one missing id stopped the script before its first line. JSX has no
 * lookups, so that failure has no way to occur.
 *
 * What did NOT go away is kept here, restated against the source that exists now:
 * markup this page must never build from a string, three DOM names the harness
 * drives the page by, and the content rules the old spec happened to hold.
 *
 * Read as text rather than imported, because these are statements about what the
 * source may contain — an import would only prove the module evaluates.
 */

const POPUP = fileURLToPath(new URL('../entrypoints/popup/', import.meta.url));

const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/<!--[\s\S]*?-->/g, '');

/**
 * Comments go first. These files explain at length why they avoid the very things
 * asserted below, so the prose names every banned pattern; matching against it
 * would report a violation that does not exist, and the natural way to "fix" that
 * is to delete the explanation.
 */
const FILES = readdirSync(POPUP)
  .filter((name) => /\.(ts|tsx|html|css)$/.test(name))
  .map((name) => ({ name, source: stripComments(readFileSync(POPUP + name, 'utf8')) }));

const ALL = FILES.map((file) => file.source).join('\n');

describe('the popup surface', () => {
  /**
   * A floor, because every assertion below is satisfied by an empty string. The
   * directory is read at runtime, so a rename that empties it would otherwise turn
   * this whole file green.
   */
  it('finds the files it is meant to check', () => {
    expect(FILES.length).toBeGreaterThan(4);
    expect(FILES.some((f) => f.name.endsWith('.tsx'))).toBe(true);
    expect(FILES.some((f) => f.name === 'index.html')).toBe(true);
    expect(ALL.length).toBeGreaterThan(4000);
  });

  /**
   * Never build this page's markup from a string.
   *
   * The rule was already true of the popup and enforced nowhere: `overlay.ts` is
   * held to it by `overlay-invariants.spec.ts`, and the popup followed by
   * convention. React turns the escape hatch into a single word that reviews as
   * ordinary, and this page renders strings it did not write — the tab's URL, and
   * whatever the worker reports as an error.
   */
  it('never assigns innerHTML, in either spelling', () => {
    for (const file of FILES) {
      expect(file.source, file.name).not.toContain('innerHTML');
      expect(file.source, file.name).not.toContain('dangerouslySetInnerHTML');
    }
  });

  /**
   * Three names the e2e harness drives this page by: it waits on `#toggle` to know
   * the page rendered at all, measures `main` for sideways overflow, and clicks
   * `#consent-ok` to get past the notice. Renaming any of them turns that suite
   * into a set of green checks measuring nothing.
   */
  it('keeps the names the harness steers by', () => {
    expect(ALL).toContain('id="consent-ok"');
    expect(ALL).toContain('id="toggle"');
    expect(ALL).toMatch(/<main\b/);
  });

  /**
   * The notice stays in the markup, out of the component tree.
   *
   * It is the only legally meaningful thing on this surface. In `index.html` it
   * renders whether or not a script ran; in the tree it would share a fate with
   * everything else — and `#toggle` is its sibling, not its child, so a failure
   * that took out the notice could leave a working Start button above it.
   */
  it('keeps the recording notice in static markup', () => {
    const html = FILES.find((f) => f.name === 'index.html')?.source ?? '';
    expect(html).toContain('id="consent"');
    expect(html).toContain('records the meeting');
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
    for (const id of ['"mode"', '"mode-note"', '"api"', '"metrics"']) {
      expect(ALL).not.toContain(`id=${id}`);
    }
    expect(ALL).not.toContain('<details');
  });

  /**
   * No typed arrow in a language direction.
   *
   * A glyph inside a string answers to nothing in the type system — its weight,
   * width and baseline shift with the face around it. Directions are written out.
   *
   * Scoped to this surface on purpose: the overlay uses the same arrow for a menu
   * path ("right-click → Chatofy"), which is a route through a UI rather than a
   * direction, and a sweep that removed both would be tidying rather than fixing.
   */
  it('writes language directions without an arrow', () => {
    expect(ALL).not.toContain('→');
  });

  /**
   * Every label names a control.
   *
   * The one that did not was the region heading above the platform list, which is a
   * legend now. `Label` from the shared package renders a `<label>`, so an instance
   * without `htmlFor` is the same defect in a new spelling: a phrase a screen
   * reader announces with nothing attached to it.
   */
  it('gives every label a control to name', () => {
    const orphans = [...ALL.matchAll(/<(?:Label|label)\b([^>]*)>/g)]
      .map((match) => match[1] ?? '')
      .filter((attributes) => !/\b(htmlFor|for)=/.test(attributes));
    expect(orphans).toEqual([]);
  });
});
