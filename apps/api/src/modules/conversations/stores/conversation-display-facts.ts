import {
  isAutoDetectConversation,
  type ConversationKind,
  type LanguageCode,
} from '@chatofy/types';

/** The most speaker names a history row lists; the count still says how many. */
export const MAX_LISTED_SPEAKERS = 4;

/**
 * How a stored conversation ran, for history to name.
 *
 * Auto-detect first, because it is read from `languages` and needs no other
 * column. Then the stored `mode`, which every save from the split pages sends.
 *
 * A row from before that column has only its turns to go on, and the rule there
 * is BOTH roles, not "a `speaker_b` turn exists". A single-source turn's role
 * comes from its language in REGISTRY order (`speakerRoleFor`: vi, then en,
 * then zh), not from which language was the source — so a one-way en→vi
 * conversation stores every turn as `speaker_b`, and only turns in both roles
 * prove that both languages were spoken.
 */
export function conversationKind(
  languages: readonly LanguageCode[],
  mode: string | null,
  roles: readonly string[],
): ConversationKind {
  if (isAutoDetectConversation(languages)) return 'auto-detect';
  if (mode === 'two-way' || mode === 'one-way') return mode;
  return roles.includes('speaker_a') && roles.includes('speaker_b')
    ? 'two-way'
    : 'one-way';
}

/** One distinct (role, label) pair of a conversation and where it first spoke. */
export interface SpeakerEntry {
  speakerRole: string;
  speakerLabel: string | null;
  firstPosition: number;
}

/**
 * Who spoke, in order of first appearance.
 *
 * A speaker is its confirmed name, or its role when nobody named it — so two
 * unnamed roles still count as two speakers, and one name used across both
 * roles counts once. Only names are listed: a role has no words of its own,
 * and the client localises the fallback.
 */
export function speakersOf(entries: readonly SpeakerEntry[]): {
  speakerCount: number;
  speakers: string[];
} {
  const seen = new Set<string>();
  const speakers: string[] = [];
  for (const entry of [...entries].sort(
    (a, b) => a.firstPosition - b.firstPosition,
  )) {
    const key = entry.speakerLabel ?? `\u0000${entry.speakerRole}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (entry.speakerLabel !== null) speakers.push(entry.speakerLabel);
  }
  return {
    speakerCount: seen.size,
    speakers: speakers.slice(0, MAX_LISTED_SPEAKERS),
  };
}
