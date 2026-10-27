'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HISTORY_LIMITS } from '@chatofy/types';
import { uploadConversationAudio } from '@/clients/api-client';
import { classifyApiFailure, type ApiFailure } from '@/lib/api-failure';
import { recordingOffsetMs } from '@/lib/transcript-time';
import type { ConversationRecording } from '@/hooks/use-conversation-recording';

export interface UseConversationAudioUpload {
  /** The recording is stored. Stays true once it is. */
  uploaded: boolean;
  /** An upload is in flight. */
  uploading: boolean;
  /**
   * The last upload failed. `terminal` means the same bytes will never succeed,
   * so no Retry is offered — the transcript is already safe either way.
   */
  failure: ApiFailure | null;
  /** Re-attempt. A no-op unless the last failure was retryable. */
  retry: () => void;
}

export interface ConversationAudioUploadInput {
  /** Re-minted per conversation; null before the first one. */
  conversationId: string | null;
  /** The conversation's start, as the transcript save reports it. */
  startedAt: string | null;
  /** The finished recording, or null while running / when none was made. */
  recording: ConversationRecording | null;
  /**
   * Whether the transcript row exists.
   *
   * The gate, not a hint: the recording points AT a conversation, so uploading
   * before the row exists would answer 404 and burn the one attempt.
   */
  saved: boolean;
}

/**
 * Stores a finished conversation's recording, once.
 *
 * ## When it fires
 *
 * On the first render where a recording exists, the transcript is saved, and this
 * conversation has not been uploaded yet. Keyed by `conversationId` so a
 * transcript re-save — which happens on every speaker rename, coalesced —
 * cannot re-send the audio. That is the whole reason this is a separate hook
 * rather than part of the transcript save: the save is a full replacement that
 * re-fires on edits, and a 10 MB body has no business riding it.
 *
 * ## What it refuses locally
 *
 * A blob over the cap never leaves the machine. The server would answer 413 at
 * the parser, which is correct but costs the whole upload to learn something the
 * client already knows.
 *
 * ## What a failure costs
 *
 * Nothing that matters. The transcript is stored first and independently, so a
 * failed recording leaves a conversation that reads exactly as it does today,
 * with no gutter times and no player.
 */
export function useConversationAudioUpload({
  conversationId,
  startedAt,
  recording,
  saved,
}: ConversationAudioUploadInput): UseConversationAudioUpload {
  // How the last attempt for `id` ended. Tagged with its conversation rather than
  // reset when the id changes: an outcome read under any other id is no outcome,
  // so the second conversation in a sitting cannot look uploaded, nor hold the
  // first one's `failure` — whose Retry would call `send` with nothing to send,
  // `recording` being already null for the new conversation.
  const [result, setResult] = useState<{ id: string; outcome: 'uploaded' | ApiFailure } | null>(
    null,
  );

  // Which conversation the first attempt was made for, so a transcript re-save
  // cannot start another.
  const attemptedFor = useRef<string | null>(null);
  // Which conversation a settling `send` still speaks for. `send` is async and
  // `conversationId` can move on before it resolves — starting a new
  // conversation while the previous one's upload is still in flight, or while a
  // Retry on it is. Tagging each call with the id it was issued for is what lets
  // its resolution recognize itself as stale instead of overwriting the outcome
  // of a conversation the reader has moved on to.
  const currentIdRef = useRef<string | null>(conversationId);

  // In the commit that changes the id rather than after paint, so a send for the
  // previous id that settles in between already recognizes itself as stale.
  useLayoutEffect(() => {
    currentIdRef.current = conversationId;
  }, [conversationId]);

  const send = useCallback(
    async (id: string, blob: Blob, timing: { offsetMs: number; durationMs: number }) => {
      let outcome: 'uploaded' | ApiFailure;
      try {
        await uploadConversationAudio(id, blob, timing);
        outcome = 'uploaded';
      } catch (err) {
        outcome = classifyApiFailure(err);
      }
      if (currentIdRef.current === id) setResult({ id, outcome });
    },
    [],
  );

  // Everything below is derived from the inputs and the outcome, so nothing has
  // to be set when an attempt starts. `ready` is the gate the attempt waits on.
  const ready = Boolean(conversationId && startedAt && recording?.blob && saved);
  const outcome = result && result.id === conversationId ? result.outcome : null;
  // Over the cap is terminal without a request: resending the same bytes cannot
  // make them smaller, which is exactly what `terminal` means.
  const tooLarge =
    ready && (recording?.blob?.size ?? 0) > HISTORY_LIMITS.MAX_CONVERSATION_AUDIO_BYTES;
  const failure: ApiFailure | null = tooLarge
    ? 'terminal'
    : outcome === 'uploaded'
      ? null
      : outcome;

  useEffect(() => {
    if (!conversationId || !startedAt || !recording?.blob || !saved) return;
    if (attemptedFor.current === conversationId) return;

    attemptedFor.current = conversationId;
    if (tooLarge) return;

    void send(conversationId, recording.blob, timingOf(recording, startedAt));
  }, [conversationId, startedAt, recording, saved, send, tooLarge]);

  const retry = useCallback(() => {
    if (failure !== 'retryable') return;
    if (!conversationId || !startedAt || !recording?.blob) return;
    // Clearing the outcome is what reads as "uploading" again.
    setResult(null);
    void send(conversationId, recording.blob, timingOf(recording, startedAt));
  }, [failure, conversationId, startedAt, recording, send]);

  return {
    uploaded: outcome === 'uploaded',
    // In flight from the moment the gate opens until an outcome lands — the
    // effect above starts the attempt in that same commit.
    uploading: ready && !tooLarge && outcome === null,
    failure,
    retry,
  };
}

/**
 * The two numbers the server stores alongside the object.
 *
 * `offsetMs` is measured from the RECORDER's start, not from `endedAt` or any
 * other conversation fact: `startedAt` is stamped before the microphone is even
 * requested, so the gap absorbs the permission prompt, the worklet load and the
 * socket connect.
 *
 * Through `recordingOffsetMs` rather than subtracting here, because this number
 * has three readers that must agree to the millisecond: this upload, the
 * transcript save that stores the same origin, and the live transcript that
 * shifts every timestamp it draws by it. Two of them arriving at it by different
 * arithmetic is precisely how a block would come to read one time while it was
 * being spoken and another when it was read back.
 *
 * `recordingOffsetMs` returns null for an unparseable `startedAt`, which becomes
 * a zero shift here. That is a CHANGE, and an improvement: the subtraction this
 * replaced produced `NaN` in that case — `Math.max(0, NaN)` is `NaN`, not 0 —
 * which reaches the query as the string `NaN` and is refused by
 * `uploadConversationAudioQuerySchema`, losing the recording outright. A zero
 * shift stores the audio and reads the timestamps as conversation time, which is
 * what a conversation with no recording already does.
 */
function timingOf(
  recording: ConversationRecording,
  startedAt: string,
): { offsetMs: number; durationMs: number } {
  return {
    offsetMs: recordingOffsetMs(recording.startedAtMs, startedAt) ?? 0,
    durationMs: Math.max(0, recording.durationMs),
  };
}
