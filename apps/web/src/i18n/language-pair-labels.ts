'use client';

import type { LanguageCode } from '@chatofy/types';
import type { LanguagePairLabels } from '@chatofy/ui/react';
import type { Translate } from '@chatofy/i18n';

/**
 * The words `LanguagePairPicker` says, in the reader's language — written once for the
 * surfaces that render it.
 *
 * The component itself defaults to English, on purpose: the extension popup renders
 * shared components and has no dictionary, so a composition that reached for a
 * translation would have to know which of two surfaces it was on. Web has a dictionary,
 * so web supplies the words. Same arrangement as `ThemeToggle`'s labels.
 *
 * ## Language names
 *
 * In the interface locale — "Tiếng Trung" in Vietnamese, "Chinese" in English — the
 * same `common.languageName.<code>` that history rows and glossary columns use, so a
 * language is called one thing everywhere on web. It used to be each language's own
 * name ("简体中文"), which a reader who does not read that language cannot pick.
 */
export function languageNamer(t: Translate): (code: LanguageCode) => string {
  return (code) => t(`common.languageName.${code}`);
}

export function languagePairLabels(t: Translate): LanguagePairLabels {
  return {
    pair: t('web.translate.languagePair'),
    source: t('web.translate.languagePairSource'),
    translation: t('web.translate.languagePairTarget'),
    swap: (from, to) => t('web.translate.languagePairSwap', { from, to }),
  };
}
