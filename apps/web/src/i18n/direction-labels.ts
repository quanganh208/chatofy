'use client';

import { LANGUAGES, type LanguageCode } from '@chatofy/types';
import type { DirectionToggleLabels } from '@chatofy/ui/react';
import type { Translate } from '@chatofy/i18n';

/**
 * The words `DirectionToggle` says, in the reader's language — written once for the
 * surfaces that render it.
 *
 * The component itself defaults to English, on purpose: the extension popup renders
 * shared components and has no dictionary, so a composition that reached for a
 * translation would have to know which of two surfaces it was on. Web has a dictionary,
 * so web supplies the words. Same arrangement as `ThemeToggle`'s labels.
 *
 * ## Language names
 *
 * The toggle names a language with its OWN name for itself — `LANGUAGES[code].nativeName`
 * reads "Tiếng Việt" regardless of which locale the interface is in, which is why this
 * takes `t` but never calls it: the parameter stays so the four existing call sites keep
 * compiling, and a locale-dependent name (`web.languageName.<code>`, used for history rows
 * and glossary columns, which DO vary by interface locale) lives in `direction-label.tsx`
 * instead.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for call-site compatibility, see above
export function makeLanguageName(t: Translate): (code: LanguageCode) => string {
  return (code) => LANGUAGES[code].nativeName;
}

export function directionLabels(t: Translate): DirectionToggleLabels {
  return {
    direction: t('web.translate.direction'),
    source: t('web.translate.directionSource'),
    translation: t('web.translate.directionTarget'),
    swap: (from, to) => t('web.translate.directionSwap', { from, to }),
  };
}
