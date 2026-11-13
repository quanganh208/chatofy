import {
  DEFAULT_VOICE_GENDER,
  languagePairSchema,
  mergePreferences,
  type LanguagePair,
  type UserPreferences,
  type UserPreferencesPatch,
  type VoiceGender,
} from '@chatofy/types';

/**
 * How the extension's own fields sit inside the account document.
 *
 * - `languagePair`  is `pairs.extension`: the extension opens with its own pair,
 *   because a meeting translates the OTHER side and no other surface does.
 * - `voiceGender`   is `voices[target].gender`: the voice belongs to the language
 *   that is spoken, which in a meeting is the pair's target. Changing the target
 *   therefore changes which stored voice the popup shows, as it does on web.
 * - `contextId`     is `contextId`, with `null` read as "no context".
 */
export interface SyncedCaptureFields {
  languagePair: LanguagePair;
  voiceGender: VoiceGender;
  contextId: string | undefined;
}

export function syncedFieldsOf(preferences: UserPreferences): SyncedCaptureFields {
  const languagePair = preferences.pairs.extension;
  return {
    languagePair,
    voiceGender: preferences.voices[languagePair.target]?.gender ?? DEFAULT_VOICE_GENDER,
    contextId: preferences.contextId ?? undefined,
  };
}

const samePair = (a: LanguagePair, b: LanguagePair) =>
  a.source === b.source && a.target === b.target;

/**
 * The patch that turns the document into one carrying `change`, or null when it
 * already does.
 *
 * Built against the current document rather than from the change alone, because
 * a gender only means something next to a target. The comparison runs against
 * what is stored NOW, so a message that repeats the old gender beside a new pair
 * (the overlay's selects do) changes the pair and leaves every voice alone, and
 * a change that equals what is stored is not sent at all.
 */
export function patchFromSynced(
  current: UserPreferences,
  change: Partial<SyncedCaptureFields> & { contextId?: string | null },
): UserPreferencesPatch | null {
  const before = syncedFieldsOf(current);
  const patch: UserPreferencesPatch = {};

  const pair = change.languagePair;
  if (pair && !samePair(pair, before.languagePair)) {
    patch.pairs = { extension: languagePairSchema.parse(pair) };
  }
  if (change.voiceGender !== undefined && change.voiceGender !== before.voiceGender) {
    const target = (pair ?? before.languagePair).target;
    patch.voices = { [target]: { gender: change.voiceGender } };
  }
  if ('contextId' in change && (change.contextId ?? undefined) !== before.contextId) {
    patch.contextId = change.contextId ?? null;
  }

  if (Object.keys(patch).length === 0) return null;
  // A patch that lands on the same document (a gender already stored for a
  // language the pair is moving to) is not worth a request.
  return JSON.stringify(mergePreferences(current, patch)) === JSON.stringify(current)
    ? null
    : patch;
}
