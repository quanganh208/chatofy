import { describe, expect, it } from 'vitest';
import { POPUP_STYLE } from '../entrypoints/popup/styles';

/**
 * The popup stylesheet, checked as the string it becomes rather than as source.
 *
 * This exists because of a real defect. A scripted edit to `styles.ts` once consumed
 * the template literal's closing backtick, so every popup loaded CSS ending in two
 * junk characters — and it shipped across several commits with nothing failing.
 * Browsers discard an unterminated token in silence, no gate in this repo parses CSS,
 * and reading the source is exactly how it stayed hidden: the source looked fine.
 *
 * The style is imported, so what these assertions see is the value the popup
 * actually injects, interpolations resolved.
 */

/** Comments first: the prose here names patterns the assertions below forbid. */
const CSS = POPUP_STYLE.replace(/\/\*[\s\S]*?\*\//g, '');

const declared = new Set([...CSS.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));
const referenced = [...CSS.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]!);

describe('POPUP_STYLE', () => {
  it('is a complete stylesheet', () => {
    // The exact shape of the bug: content after the final rule, left behind by an
    // edit that ate the delimiter.
    expect(CSS.trimEnd().endsWith('}')).toBe(true);
    const opens = (CSS.match(/\{/g) ?? []).length;
    const closes = (CSS.match(/\}/g) ?? []).length;
    expect(opens).toBe(closes);
    expect(opens).toBeGreaterThan(20);
  });

  it('leaves no interpolation unresolved', () => {
    // A `${...}` surviving into the value means the string was assembled as a plain
    // quote somewhere, and the popup renders with the literal text in its CSS.
    expect(CSS).not.toContain('${');
  });

  it('declares every variable it reads', () => {
    const dangling = [...new Set(referenced)].filter((name) => !declared.has(name));
    expect(dangling).toEqual([]);
    // A floor, because the assertion above passes on a sheet that reads nothing.
    expect(referenced.length).toBeGreaterThan(30);
  });

  /**
   * Both grounds, in one declaration each.
   *
   * A token reverted to a single value renders one scheme correctly and the other on
   * the wrong ground — the same failure the web parity spec guards, in the surface
   * that has no parity spec of its own.
   */
  it('gives every colour token both halves', () => {
    const colours = [...CSS.matchAll(/(--[\w-]+):\s*([^;]+);/g)].filter(([, , value]) =>
      /#[0-9a-f]{3,8}|light-dark\(/i.test(value!),
    );
    const single = colours.filter(([, , value]) => !value!.trim().startsWith('light-dark('));
    expect(single.map(([, name]) => name)).toEqual([]);
    expect(colours.length).toBeGreaterThan(15);
  });

  /**
   * The form controls are drawn, not the platform's.
   *
   * The file header has claimed this since it was written, and for a long time it
   * was false: colours were set on the selects and checkboxes while the platform
   * kept drawing the frame, the arrow and the box, because nothing said
   * `appearance: none`. Colours alone do not take a control over — that is the
   * difference this asserts.
   */
  it('takes the form controls off the platform', () => {
    expect(CSS).toMatch(/(^|[^-\w])select\s*\{[^}]*appearance:\s*none/m);
    expect(CSS).toMatch(/input\[type='checkbox'\]\s*\{[^}]*appearance:\s*none/);
    // The select's own arrow goes with its frame, so one has to be drawn back.
    expect(CSS).toMatch(/\.select::after\s*\{/);
    // And the checkbox's tick, which is only ever on the checked state.
    expect(CSS).toMatch(/input\[type='checkbox'\]:checked::after\s*\{/);
  });

  /**
   * A fieldset is the one block that will not shrink.
   *
   * `min-inline-size: min-content` comes from the UA sheet, and with three nowrap
   * platform details inside one, the group grew past the 320px pane — which the
   * scrolling pane turned into a horizontal scrollbar over already-ellipsised
   * text. The e2e suite measures the outcome; this guards the declaration, which
   * is the part that reads as removable.
   */
  it('lets the setting groups shrink to the pane', () => {
    expect(CSS).toMatch(/\.group\s*\{[^}]*min-inline-size:\s*0/);
  });

  it('lets the machine decide when nothing is chosen', () => {
    // Without this the two classes are the only way to get a ground, and someone who
    // has never opened the setting gets whichever one is written first.
    expect(CSS).toMatch(/:root\s*\{[^}]*color-scheme:\s*light dark/);
    expect(CSS).toMatch(/:root\.light\s*\{[^}]*color-scheme:\s*light\s*;/);
    expect(CSS).toMatch(/:root\.dark\s*\{[^}]*color-scheme:\s*dark\s*;/);
  });
});
