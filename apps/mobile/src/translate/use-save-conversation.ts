/**
 * Saves a translate conversation once it has finished, and offers a retry.
 *
 * A save is a PUT keyed by the conversation id, so sending it again after a
 * dropped response replaces rather than duplicates. The first attempt decides
 * when the conversation ended and every retry repeats that instant.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ConversationStatus,
  PauseInterval,
  TurnKeyedTranscript,
} from '@chatofy/realtime-client';
import { saveConversation } from '@/clients/api-client';
import { buildSaveRequest, classifySaveFailure, type SaveFailure } from './save-conversation';
import type { ConversationIdentity } from './use-translate-conversation';

export type SaveState =
  | { phase: 'idle' }
  | { phase: 'saving' }
  | { phase: 'saved' }
  | { phase: 'failed'; failure: SaveFailure };

const IDLE: SaveState = { phase: 'idle' };

interface Input {
  status: ConversationStatus;
  conversation: TurnKeyedTranscript;
  identity: ConversationIdentity | null;
  pauses: readonly PauseInterval[];
}

export function useSaveConversation(input: Input): { state: SaveState; retry: () => void } {
  const { status, identity } = input;
  // The outcome belongs to ONE conversation; a new one starts from idle without a reset effect.
  const [record, setRecord] = useState<{ id: string; state: SaveState } | null>(null);

  const savedIdRef = useRef<string | null>(null);
  const endedAtRef = useRef<{ id: string; at: string } | null>(null);
  const previousStatusRef = useRef<ConversationStatus>('idle');
  // The latest transcript, read when a save actually fires rather than when it was scheduled.
  const latestRef = useRef(input);
  useEffect(() => {
    latestRef.current = input;
  });

  const save = useCallback(async () => {
    const { conversation, identity: who, pauses } = latestRef.current;
    if (!who || savedIdRef.current === who.id) return;
    if (endedAtRef.current?.id !== who.id) {
      endedAtRef.current = { id: who.id, at: new Date().toISOString() };
    }
    const body = buildSaveRequest({
      conversation,
      identity: who,
      pauses,
      endedAt: endedAtRef.current.at,
    });
    // Nothing was said: there is nothing to keep, and nothing to report.
    if (!body) return;
    setRecord({ id: who.id, state: { phase: 'saving' } });
    try {
      await saveConversation(who.id, body);
      savedIdRef.current = who.id;
      setRecord({ id: who.id, state: { phase: 'saved' } });
    } catch (err) {
      setRecord({ id: who.id, state: { phase: 'failed', failure: classifySaveFailure(err) } });
    }
  }, []);

  // A run that has ended: it was on, and now nothing is open.
  useEffect(() => {
    const wasOn = previousStatusRef.current !== 'idle';
    previousStatusRef.current = status;
    if (status === 'idle' && wasOn && identity) void save();
  }, [status, identity, save]);

  const retry = useCallback(() => {
    void save();
  }, [save]);

  const state = record && identity && record.id === identity.id ? record.state : IDLE;
  return { state, retry };
}
