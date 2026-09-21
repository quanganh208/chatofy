import {
  ProviderAbortedError,
  type TtsAudioStream,
} from '@chatofy/ai-providers';
import { pushTranslatedPcm } from './outbound-audio-framer';
import type { ClauseDelivery } from './turn-timeline';

/**
 * Put a turn's streamed speech on the wire as the backend produces it.
 *
 * The clause loop this replaces waited for each clause's whole WAV before any of
 * it went out, so the listener's first sound was the first clause's full
 * synthesis time. Here the first frame leaves as soon as the backend's first
 * chunk arrives — for VieNeu, a quarter of a second into a turn the clause loop
 * took 0.8-1.2s to start speaking.
 *
 * Every chunk is sliced and sent the moment it arrives, never held back to fill
 * a whole frame: the stream leads playback by only ~100 ms, so buffering up to a
 * frame's 200 ms would turn a stream that keeps up into one that stutters.
 */
export interface StreamedSpeechDeps {
  stream: TtsAudioStream;
  sessionId: string;
  emit: (frame: {
    sessionId: string;
    encoding: 'pcm16';
    sampleRate: number;
    sequence: number;
    timestamp: number;
    payload: string;
  }) => void;
  nextSequence: () => number;
  /** False once the listener has gone; checked on every chunk. */
  stillWanted: () => boolean;
  /**
   * Map a provider fault met mid-stream to the error the turn reports. Always
   * throws, so a turn that breaks after N chunks is a failure, never `completed`.
   */
  fail: (err: unknown) => never;
  now?: () => number;
}

export async function deliverStreamedSpeech(
  deps: StreamedSpeechDeps,
): Promise<ClauseDelivery> {
  const now = deps.now ?? Date.now;
  let firstAudioAt: number | undefined;
  let lastAudioAt: number | undefined;
  // A network chunk can end halfway through a 16-bit sample; the odd byte waits
  // here for the chunk that completes it, so no frame ever splits a sample.
  let carry: Buffer | null = null;

  try {
    for await (const chunk of deps.stream.chunks) {
      // Leaving the loop cancels the request, which is what frees the engine
      // for the next turn waiting on it.
      if (!deps.stillWanted()) {
        return { firstAudioAt, lastAudioAt, stoppedBy: 'client_gone' };
      }

      const bytes: Buffer = carry
        ? Buffer.concat([carry, Buffer.from(chunk)])
        : Buffer.from(chunk);
      const whole = bytes.length - (bytes.length % 2);
      carry = whole < bytes.length ? bytes.subarray(whole) : null;
      if (whole === 0) continue;

      pushTranslatedPcm(
        deps.emit,
        deps.sessionId,
        deps.nextSequence,
        bytes.subarray(0, whole),
        deps.stream.sampleRate,
      );
      firstAudioAt ??= now();
      lastAudioAt = now();
    }
  } catch (err) {
    // The turn left the registry while its audio was still arriving: the
    // listener is gone, which is an abandoned turn and not a synthesis fault.
    if (err instanceof ProviderAbortedError) {
      return { firstAudioAt, lastAudioAt, stoppedBy: 'client_gone' };
    }
    deps.fail(err);
  }

  return { firstAudioAt, lastAudioAt };
}
