import type { Translate } from '@chatofy/i18n';

/**
 * "1 line" / "2 lines". The dictionary has no plural machinery by design
 * (`packages/i18n/src/t.ts`), so the singular is its own key; Vietnamese writes
 * the same word in both.
 */
export function turnCountLabel(t: Translate, count: number): string {
  return count === 1 ? t('web.history.turnCountOne') : t('web.history.turnCount', { count });
}
