import { describe, expect, it } from 'vitest';
import { asLocale, createTranslator, DEFAULT_LOCALE, en, LOCALES } from './index.js';

describe('createTranslator', () => {
  const t = createTranslator(en);

  it('reads a string', () => {
    expect(t('web.auth.signIn')).toBe('Sign in');
  });

  it('substitutes a placeholder', () => {
    const local = createTranslator({ ...en, 'web.auth.signIn': 'Hello {name}' });
    expect(local('web.auth.signIn', { name: 'Ada' })).toBe('Hello Ada');
  });

  /**
   * A blank is invisible in a screenshot and in review; a key is obviously wrong
   * and says which one. This is only reachable through a raw string that bypassed
   * `MessageKey` — app code is typed, a test passing a literal is not.
   */
  it('returns the key when there is no entry', () => {
    // @ts-expect-error the point of the test is the untyped path a spec can take
    expect(t('web.nope.missing')).toBe('web.nope.missing');
  });

  it('leaves a placeholder with no value as written', () => {
    const local = createTranslator({ ...en, 'web.auth.signIn': 'Hello {name}' });
    expect(local('web.auth.signIn', { other: 'x' })).toBe('Hello {name}');
  });

  it('formats a number without a locale-specific separator', () => {
    const local = createTranslator({ ...en, 'web.auth.signIn': '{n} left' });
    expect(local('web.auth.signIn', { n: 3 })).toBe('3 left');
  });
});

describe('asLocale', () => {
  it.each(LOCALES)('accepts %s', (locale) => {
    expect(asLocale(locale)).toBe(locale);
  });

  /**
   * `undefined` rather than the default, because the negotiation order in web has
   * to tell "nothing stored" apart from "explicitly English" — collapsing them
   * would make a stored `en` indistinguishable from a first visit, and the
   * Accept-Language step would then run for someone who had already chosen.
   */
  it.each([null, undefined, '', 'xx', 'EN', 'en-GB', 'vi-VN'])(
    'refuses %s rather than defaulting',
    (value) => {
      expect(asLocale(value)).toBeUndefined();
    },
  );

  it('ships a default that is itself a locale', () => {
    expect(asLocale(DEFAULT_LOCALE)).toBe(DEFAULT_LOCALE);
  });
});
