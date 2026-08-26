'use client';

import { languageName, type DirectionToggleLabels } from '@chatofy/ui/react';
import type { Translate } from '@chatofy/i18n';

/**
 * The words `DirectionToggle` says, in the reader's language — written once for the
 * four surfaces that render it.
 *
 * The component itself defaults to English, on purpose: the extension popup renders
 * shared components and has no dictionary, so a composition that reached for a
 * translation would have to know which of two surfaces it was on. Web has a dictionary,
 * so web supplies the words. Same arrangement as `ThemeToggle`'s labels.
 *
 * ## Language names
 *
 * `languageName` in `@chatofy/ui` pins Vietnamese and English to their ENGLISH names,
 * which is right for a package with no locale and wrong on a Vietnamese page. So the
 * two this product is about come from the dictionary, and anything else falls through
 * to that helper — which handles a code the model returned that neither locale pins.
 *
 * That fallback is English in both locales, and it is a known gap rather than an
 * oversight: it is reached only by `live.detectedLanguage` on the unlinked experiment
 * route, for a language that is neither of the two being translated.
 */
export function makeLanguageName(t: Translate): (code: string | null | undefined) => string {
  return (code) => {
    const base = code?.trim().toLowerCase().split(/[-_]/)[0];
    if (base === 'vi') return t('common.language.vietnamese');
    if (base === 'en') return t('common.language.english');
    return languageName(code);
  };
}

export function directionLabels(t: Translate): DirectionToggleLabels {
  return {
    direction: t('web.translate.direction'),
    source: t('web.translate.directionSource'),
    translation: t('web.translate.directionTarget'),
    swap: (from, to) => t('web.translate.directionSwap', { from, to }),
  };
}
