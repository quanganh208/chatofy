/**
 * Turns a finished translate conversation into the body `PUT /conversations/:id`
 * takes, and says what a failed save means for the reader.
 *
 * The projection of turns is `toConversationTurns` from `@chatofy/realtime-client`,
 * the one web saves with, so a conversation reads the same in History whichever
 * device it was spoken on.
 */

import {
  toConversationTurns,
  type PauseInterval,
  type TurnKeyedTranscript,
} from '@chatofy/realtime-client';
import type { SaveConversationRequest, SessionLanguagePair } from '@chatofy/types';
import { ApiClientError } from '@chatofy/api-client';
import { storedLanguages } from './translate-mode.ts';

export type SaveFailure = 'retryable' | 'terminal';

/** Statuses that resending the same body can never fix. Anything else may be transient. */
const TERMINAL_STATUSES = new Set([400, 401, 404, 409, 413, 415]);

export function classifySaveFailure(err: unknown): SaveFailure {
  return err instanceof ApiClientError && TERMINAL_STATUSES.has(err.status)
    ? 'terminal'
    : 'retryable';
}

/** Total paused time, counting only intervals that have ended. */
export function pausedMsOf(pauses: readonly PauseInterval[]): number {
  return pauses.reduce(
    (total, pause) =>
      pause.endedAt === null ? total : total + Math.max(0, pause.endedAt - pause.startedAt),
    0,
  );
}

export interface SaveInput {
  conversation: Pick<
    TurnKeyedTranscript,
    'turns' | 'speakers' | 'attributions' | 'captures' | 'displays'
  >;
  identity: { startedAt: string; pair: SessionLanguagePair; askedTwoWay: boolean };
  pauses: readonly PauseInterval[];
  /** The instant the conversation ended; the first save decides it and retries repeat it. */
  endedAt: string;
}

/** The save body, or null when nothing was said (there is nothing to keep). */
export function buildSaveRequest(input: SaveInput): SaveConversationRequest | null {
  const { conversation, identity, pauses, endedAt } = input;
  if (conversation.turns.length === 0) return null;
  const startedAtMs = Date.parse(identity.startedAt);
  const spanMs = Math.max(0, Date.parse(endedAt) - startedAtMs);
  return {
    languages: storedLanguages(identity.pair),
    startedAt: identity.startedAt,
    endedAt,
    turns: toConversationTurns(conversation, startedAtMs, pauses),
    audioOffsetMs: null,
    // Bounded by the span: a clock that steps mid-pause could push the total past the
    // conversation's length, which the API refuses with a 400 that is never retried.
    pausedMs: Math.min(Math.max(0, Math.round(pausedMsOf(pauses))), spanMs),
    mode: identity.askedTwoWay ? 'two-way' : 'one-way',
    titleLanguage: 'en',
  };
}
