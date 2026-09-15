'use client';

import { useCallback, useRef } from 'react';
import { HISTORY_LIMITS } from '@chatofy/types';

/**
 * Containers to try, in order.
 *
 * Chromium and Firefox produce WebM/Opus; Safari's `MediaRecorder` produces MP4
 * and cannot play WebM at all, so the MP4 entry is a REAL branch for a supported
 * browser rather than a defensive tail. `sniffConversationAudio` on the API
 * accepts exactly these two, and the extension in the stored key comes from that
 * sniff — so adding a candidate here without adding its signature there stores an
 * object the download route cannot type.
 */
const CANDIDATE_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

/**
 * Recorder bitrate.
 *
 * Read from `@chatofy/types` rather than declared here, and paired there with
 * `MAX_CONVERSATION_AUDIO_BYTES`: 24 kbps is 3,000 bytes/s, so the 32 MiB cap is
 * reached at about 3h06m. Changing this without changing that silently shortens
 * the longest conversation that can be recorded — sharing the export is what
 * lets a test on either side notice.
 */
const AUDIO_BITS_PER_SECOND = HISTORY_LIMITS.AUDIO_RECORDER_BITS_PER_SECOND;

/** What a finished recording hands back. */
export interface ConversationRecording {
  /** Null when no candidate container was supported, or nothing was captured. */
  blob: Blob | null;
  /**
   * When the recorder actually started, as epoch ms.
   *
   * Stamped even when recording could not start, because the TIMESTAMP half of
   * this feature must not depend on the AUDIO half: a browser with no supported
   * container still shows a transcript, and a gutter computed from a missing
   * recorder would be silently wrong rather than absent.
   */
  startedAtMs: number;
  /** Wall-clock length, in ms. Zero when nothing was recorded. */
  durationMs: number;
}

export interface UseConversationRecording {
  /**
   * Begin recording the stream, and hand it back untouched.
   *
   * Shaped as a pass-through so it can wrap `openMicrophone` in the session's
   * dependency object: `ConversationSession` receives the same `MediaStream` it
   * would have received anyway and learns nothing about recording.
   */
  attach: (stream: MediaStream) => MediaStream;
  /** Stop and collect. Resolves null when nothing was ever attached. */
  finish: () => Promise<ConversationRecording | null>;
}

/**
 * Records the whole conversation from the microphone stream the session opens.
 *
 * ## Why a second tap rather than the audio the server already receives
 *
 * The server never receives the conversation. `capture-pump.ts` discards
 * everything outside a turn and, in half duplex, ignores the microphone entirely
 * while our own translation is sounding — so server-side audio is a gappy
 * sequence of utterances whose media time does not correspond to wall clock.
 * Reconstructing a recording from it would mean synthesising silence for every
 * gap, and the timestamps would still point at the wrong moment.
 *
 * ## Why it records straight through pause
 *
 * `ConversationSession.pause()` releases nothing (it stops no tracks), so the
 * stream stays live and this keeps writing. That is deliberate: a paused recorder
 * makes media time diverge from wall-clock time, and every offset after the first
 * pause would be wrong by the accumulated pause length. The cost is real and the
 * landing copy has to carry it — a person who believes pause silences the
 * microphone would be mistaken.
 *
 * ## What it records
 *
 * The PROCESSED signal: `CONVERSATION_AUDIO` asks for echo cancellation, noise
 * suppression and automatic gain. That is what the recognizer was given, which is
 * what makes the recording able to answer "was this a bad recognition or a bad
 * translation".
 */
export function useConversationRecording(): UseConversationRecording {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const startedAtRef = useRef<number | null>(null);
  // Resolved by the recorder's own `stop` event, never by `finish()`. See the
  // comment inside `finish` for why that distinction is the whole of this hook.
  const resultRef = useRef<Promise<ConversationRecording> | null>(null);

  const attach = useCallback((stream: MediaStream): MediaStream => {
    // Stamped BEFORE the recorder is constructed, and kept even if construction
    // throws: the timestamps must not depend on the recording succeeding.
    const startedAtMs = Date.now();
    startedAtRef.current = startedAtMs;
    recorderRef.current = null;
    resultRef.current = null;

    const mimeType = CANDIDATE_TYPES.find(
      (type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(type),
    );
    if (!mimeType) return stream;

    let recorder: MediaRecorder;
    let result: Promise<ConversationRecording>;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });

      const chunks: Blob[] = [];
      // The result is assembled HERE, by the recorder, at the moment it actually
      // stops — which is not the moment anybody asks for it.
      result = new Promise<ConversationRecording>((resolve) => {
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onstop = () => {
          resolve({
            blob: chunks.length > 0 ? new Blob(chunks, { type: recorder.mimeType }) : null,
            startedAtMs,
            // Stamped in the STOP handler. Measuring at `finish()` time instead
            // would add however long the drain ran to every stored duration, and
            // the scrubber would then have a maximum past the end of the audio.
            durationMs: Math.max(0, Date.now() - startedAtMs),
          });
        };
      });

      // Inside the same guarded region as construction, not after it: `start()`
      // can itself throw — an `InvalidStateError`, or a browser-specific refusal
      // — and this call is what `attach` was invoked FOR, from inside
      // `openMicrophone`'s dependency. A throw that escaped here would reject
      // conversation start entirely, before `local.stream` is ever assigned, so
      // `releaseResources` in the catch above it would have no stream to stop —
      // leaving the microphone getUserMedia already granted live and unreleased.
      // Degrading to "transcript, no audio" is the invariant this hook's own
      // docs already promise for a construction failure; a start failure earns
      // the identical treatment.
      recorder.start();
    } catch {
      // Whichever of the two failed, the stream this hook was handed is still
      // the caller's: it was never touched, no track was stopped or consumed, so
      // there is nothing here to release. The conversation proceeds with a
      // transcript and no audio, exactly as it does today.
      recorderRef.current = null;
      resultRef.current = null;
      return stream;
    }

    recorderRef.current = recorder;
    resultRef.current = result;
    return stream;
  }, []);

  const finish = useCallback(async (): Promise<ConversationRecording | null> => {
    const startedAtMs = startedAtRef.current;
    if (startedAtMs === null) return null;
    startedAtRef.current = null;

    const recorder = recorderRef.current;
    const result = resultRef.current;
    recorderRef.current = null;
    resultRef.current = null;

    // No recorder at all — an unsupported container, or a construction that
    // threw. The conversation still has its transcript and its timestamps.
    if (!recorder || !result) return { blob: null, startedAtMs, durationMs: 0 };

    // ## Why this does not branch on `recorder.state`
    //
    // By the time this runs the recorder is ALWAYS `inactive`, and an earlier
    // revision read that as "nothing was recorded" and returned null — throwing
    // away every recording on the normal End path, silently, with no failure
    // alert and nothing in the bucket.
    //
    // The ordering is the reason. `ConversationSession.finish()` stops every
    // microphone track, which per the MediaStream Recording spec ends the
    // recorder: it fires `dataavailable`, then `stop`, and goes inactive. Only
    // THEN does the session drain — waiting seconds for the last translation to
    // be spoken — before emitting `idle`, which is what calls this. So the
    // recorder has been finished for the whole length of the drain.
    //
    // `stop()` here is a no-op in that common case, and a real stop only on a
    // path that releases the recorder without ending its tracks. Either way the
    // promise is what carries the result, and the recorder resolved it.
    if (recorder.state !== 'inactive') recorder.stop();
    return result;
  }, []);

  return { attach, finish };
}
