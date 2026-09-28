import { describe, expect, it } from 'vitest';
import { DeclaredLanguageIdentifier } from './language-identifier';

describe('DeclaredLanguageIdentifier', () => {
  it('returns the declared language, wrapped in a single-element array', () => {
    const identifier = new DeclaredLanguageIdentifier();

    expect(identifier.identify({ declared: 'vi' })).toEqual(['vi']);
    expect(identifier.identify({ declared: 'en' })).toEqual(['en']);
  });

  it('answers the same way every time — it never looks at audio', () => {
    // The interface takes no audio at all; this pins that the only
    // implementation today reads nothing but the field it was given.
    const identifier = new DeclaredLanguageIdentifier();

    const first = identifier.identify({ declared: 'vi' });
    const second = identifier.identify({ declared: 'vi' });

    expect(first).toEqual(second);
  });
});
