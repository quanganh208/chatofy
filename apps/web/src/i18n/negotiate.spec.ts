import { describe, expect, it } from 'vitest';

import { negotiateLocale } from './negotiate';

/**
 * A header anyone can send, parsed into one of two answers.
 *
 * Only consulted on a first visit — after that the cookie is authoritative, including
 * when it disagrees with the browser. An explicit choice must not be negotiated away.
 *
 * The q-ranking is the part worth testing. Taking the first tag alone is right for
 * almost every real header and wrong for the one that matters: a browser whose first
 * choice this product does not have, listing one it does further down.
 */
describe('negotiateLocale', () => {
  it.each([
    ['vi', 'vi', 'the plain case'],
    ['vi-VN', 'vi', 'a region subtag is the same dictionary'],
    ['VI', 'vi', 'case is not part of a tag'],
    ['en-US,en;q=0.9', 'en', 'English asked for, English given'],
    ['xh,vi;q=0.9,en;q=0.8', 'vi', 'the highest-ranked tag this product HAS'],
    ['en;q=0.4,vi;q=0.9', 'vi', 'ranking beats order'],
    ['vi;q=0, en;q=0.5', 'en', 'q=0 means "not this one"'],
    ['fr,de', 'en', 'nothing supported falls back'],
    ['', 'en', 'an empty header'],
    ['*', 'en', 'a wildcard names nothing in particular'],
    ['vi;q=abc', 'vi', 'a malformed q sorts as zero rather than throwing'],
    [';;;,,,', 'en', 'nonsense answers with the fallback, not a 500'],
  ])('%s → %s (%s)', (header, expected) => {
    expect(negotiateLocale(header)).toBe(expected);
  });

  it.each([[null], [undefined]])('falls back when there is no header (%s)', (header) => {
    expect(negotiateLocale(header)).toBe('en');
  });
});
