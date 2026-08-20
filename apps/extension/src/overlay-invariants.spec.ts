import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OVERLAY_STYLE } from '../entrypoints/content/overlay-styles';

/**
 * The overlay's non-negotiables, as assertions rather than comments.
 *
 * Everything checked here was already written down and already true — and none of
 * it was tested, because `vitest.config.ts` includes only `src/**` and the overlay
 * lives under `entrypoints/`. Each of these fails silently by construction: a page
 * that can read the transcript, an overlay that has become invisible while still
 * passing a hit test, a themable hook a meeting site can grab. There is no symptom
 * to notice, which is the whole reason for pinning them from a directory the test
 * runner does look at.
 *
 * The style is imported rather than read as text. That is the same anchor
 * `token-parity.spec.ts` relies on: a value that was really evaluated cannot come
 * back empty because a regex stopped matching.
 */

const OVERLAY_SOURCE = readFileSync(
  fileURLToPath(new URL('../entrypoints/content/overlay.ts', import.meta.url)),
  'utf8',
);

/**
 * Comments go first, everywhere below.
 *
 * Both files explain at length why they avoid the very things asserted here, so
 * the prose quotes every banned pattern. Matching against it would report a
 * violation that does not exist, and the natural way to "fix" that is to delete
 * the explanation — removing the note that keeps the next person from
 * reintroducing the real thing.
 */
const stripCss = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const stripTs = (ts: string) =>
  ts.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const STYLE = stripCss(OVERLAY_STYLE);
const SOURCE = stripTs(OVERLAY_SOURCE);

describe('OVERLAY_STYLE', () => {
  /**
   * `all: initial !important` is blanket, so a second `:host` rule anywhere in
   * this sheet loses to it without warning — `:host { display: block }` added
   * while rearranging the panel would simply not apply.
   *
   * Asserted as exactly one rather than at least one on purpose: zero means the
   * regex stopped matching, and that must fail differently from two.
   */
  it('carries exactly one :host rule', () => {
    const hostRules = STYLE.match(/:host\s*\{[^}]*\}/g) ?? [];
    expect(hostRules).toHaveLength(1);
    expect(hostRules[0]).toContain('all: initial !important');
  });

  /**
   * A custom property on the host is a public styling interface. A meeting site
   * that finds one can restyle the overlay it is not supposed to reach into, so
   * every colour in this sheet is interpolated as a literal value instead.
   */
  it('resolves every token to a literal, never a custom property', () => {
    expect(STYLE).not.toContain('var(');
  });

  // A floor, not decoration: every assertion above is satisfied by an empty
  // string, and an import that silently resolved to nothing would pass them all.
  it('was actually read', () => {
    expect(STYLE.length).toBeGreaterThan(2000);
  });
});

describe('overlay.ts', () => {
  /**
   * Every transcript line is model output derived from a private meeting. Assigned
   * as text, it is text; assigned as markup, the meeting decides what it is.
   */
  it('never assigns innerHTML', () => {
    expect(SOURCE).not.toContain('innerHTML');
  });

  /**
   * The shadow root stays closed so the page cannot read a private meeting's
   * transcript back out of our own DOM.
   */
  it('attaches a closed shadow root', () => {
    expect(SOURCE).toContain("attachShadow({ mode: 'closed' })");
    expect(SOURCE).not.toContain("mode: 'open'");
  });

  /**
   * No id on the host — not as protection, which is the `:host` reset's job, but
   * so a meeting site cannot detect a Chatofy user by querying for one.
   */
  it('leaves the host element unidentifiable', () => {
    expect(SOURCE).not.toMatch(/host\.id\s*=/);
    expect(SOURCE).not.toMatch(/host\.setAttribute\(\s*['"]id['"]/);
  });

  // The same floor as above, for the same reason: these are all absence
  // assertions, and absence is what an unread file looks like.
  it('was actually read', () => {
    expect(SOURCE.split('document.createElement').length - 1).toBeGreaterThan(10);
  });
});
