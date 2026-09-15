'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { HISTORY_LIMITS } from '@chatofy/types';
import { uploadConversationAudio } from '@/clients/api-client';
import { classifyApiFailure, type ApiFailure } from '@/lib/api-failure';
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
  const [uploaded, setUploaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  // Which conversation the flags above describe. A new conversation resets them;
  // without this, the second conversation in a sitting would look uploaded.
  const attemptedFor = useRef<string | null>(null);
  // Which conversation a settling `send` still speaks for. `send` is async and
  // `conversationId` can move on before it resolves — starting a new
  // conversation while the previous one's upload is still in flight, or while a
  // Retry on it is. Tagging each call with the id it was issued for is what lets
  // its resolution recognize itself as stale instead of setting `failure` or
  // `uploaded` on a conversation the reader already left.
  const currentIdRef = useRef<string | null>(conversationId);

  // The conversation changed under this hook: forget what the LAST one reported.
  // Without this, conversation 2 renders holding conversation 1's `failure` —
  // `recording` here is already null for conversation 2, so its Retry button
  // would call `send` with nothing to send.
  useEffect(() => {
    currentIdRef.current = conversationId;
    setUploaded(false);
    setUploading(false);
    setFailure(null);
  }, [conversationId]);

  const send = useCallback(
    async (id: string, blob: Blob, timing: { offsetMs: number; durationMs: number }) => {
      setUploading(true);
      setFailure(null);
      try {
        await uploadConversationAudio(id, blob, timing);
        if (currentIdRef.current !== id) return;
        setUploaded(true);
      } catch (err) {
        if (currentIdRef.current !== id) return;
        setFailure(classifyApiFailure(err));
      } finally {
        if (currentIdRef.current === id) setUploading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!conversationId || !startedAt || !recording?.blob || !saved) return;
    if (attemptedFor.current === conversationId) return;

    attemptedFor.current = conversationId;
    setUploaded(false);
    setFailure(null);

    if (recording.blob.size > HISTORY_LIMITS.MAX_CONVERSATION_AUDIO_BYTES) {
      // Terminal without a request: resending the same bytes cannot make them
      // smaller, which is exactly what `terminal` means.
      setFailure('terminal');
      return;
    }

    void send(conversationId, recording.blob, timingOf(recording, startedAt));
  }, [conversationId, startedAt, recording, saved, send]);

  const retry = useCallback(() => {
    if (failure !== 'retryable') return;
    if (!conversationId || !startedAt || !recording?.blob) return;
    void send(conversationId, recording.blob, timingOf(recording, startedAt));
  }, [failure, conversationId, startedAt, recording, send]);

  return { uploaded, uploading, failure, retry };
}

/**
 * The two numbers the server stores alongside the object.
 *
 * `offsetMs` is measured from the RECORDER's start, not from `endedAt` or any
 * other conversation fact: `startedAt` is stamped before the microphone is even
 * requested, so the gap absorbs the permission prompt, the worklet load and the
 * socket connect. Clamped at zero because a negative would mean the two
 * `Date.now()` readings disagreed, not that recording began before the
 * conversation.
 */
function timingOf(
  recording: ConversationRecording,
  startedAt: string,
): { offsetMs: number; durationMs: number } {
  return {
    offsetMs: Math.max(0, recording.startedAtMs - Date.parse(startedAt)),
    durationMs: Math.max(0, recording.durationMs),
  };
}
