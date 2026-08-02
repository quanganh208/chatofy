import type { TranslationDirection } from '@chatofy/types';

/**
 * The other way round.
 *
 * One conversation has one language pair, so the direction the user's own speech
 * is translated in is not a second setting — it is this one, reversed. Offering
 * both independently would let someone select two directions that describe no
 * conversation at all.
 */
export function reverseDirection(direction: TranslationDirection): TranslationDirection {
  return direction === 'vi_to_en' ? 'en_to_vi' : 'vi_to_en';
}
