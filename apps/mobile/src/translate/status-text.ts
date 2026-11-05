/**
 * The words for what the translate screen is doing, kept apart from the screen so
 * the mapping is checked once and every state has a sentence.
 */

import type { MessageKey } from '@chatofy/i18n';
import type { ConversationStatus } from '@chatofy/realtime-client';
import {
  AUTO_DETECT,
  type LanguageCode,
  type SessionLanguageMode,
  type SessionLanguagePair,
} from '@chatofy/types';
import { ranOneWayInstead } from './translate-refusal.ts';

/** Exhaustive on purpose: a new status without a sentence fails to compile. */
const STATUS_KEY: Record<ConversationStatus, MessageKey> = {
  idle: 'web.translate.notListening',
  connecting: 'web.translate.connecting',
  listening: 'web.translate.listening',
  'hearing-speech': 'web.translate.hearingYou',
  translating: 'web.translate.translating',
  playing: 'web.translate.speaking',
  paused: 'web.translate.paused',
  finishing: 'web.translate.finishing',
};

export function statusKey(status: ConversationStatus): MessageKey {
  return STATUS_KEY[status];
}

const LANGUAGE_NAME_KEY: Record<LanguageCode, MessageKey> = {
  vi: 'common.languageName.vi',
  en: 'common.languageName.en',
  zh: 'common.languageName.zh',
};

export function languageNameKey(code: LanguageCode): MessageKey {
  return LANGUAGE_NAME_KEY[code];
}

/** Whether a conversation is on (microphone open or winding down), as opposed to not started or finished. */
export function isRunning(status: ConversationStatus): boolean {
  return status !== 'idle';
}

/**
 * A notice when a two-way start is being run one way, and what to say in it.
 * `null` when there is nothing to explain.
 */
export function oneWayNotice(
  pair: SessionLanguagePair,
  askedTwoWay: boolean,
  granted: SessionLanguageMode | null,
): { key: MessageKey; from: LanguageCode; to: LanguageCode } | null {
  if (pair.source === AUTO_DETECT || !ranOneWayInstead(askedTwoWay, granted)) return null;
  return { key: 'web.translate.twoWayUnavailable', from: pair.source, to: pair.target };
}
