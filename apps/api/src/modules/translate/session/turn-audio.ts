import { MAX_SAMPLE_RATE } from '@chatofy/types';
import { encodePcm16Wav } from '../audio/wav-codec';

/** Inbound audio is mono; the contract carries no channel count. */
const INBOUND_CHANNELS = 1;

/**
 * Longest utterance a single turn will buffer. A conversational turn is a
 * sentence or two; anything past this is a stuck client, and the buffer is held
 * in memory until the turn ends.
 */
export const MAX_TURN_SECONDS = 60;

/**
 * Hard byte ceiling for ONE turn's buffer. 5.76 MB at the current numbers.
 *
 * Derived from the contract's highest permitted rate rather than from the rate
 * the client reported: the socket is unauthenticated, and a cap scaled by a
 * client-supplied number is not a cap.
 *
 * Per turn, not per socket — a socket now holds several turns at once, each with
 * its own buffer, so what a single connection can pin is this times the
 * concurrency ceiling. `MAX_BUFFERED_BYTES_PER_SOCKET` in `turn-concurrency.ts`
 * states that product, because raising the turn ceiling raises the memory bound
 * by the same factor and the real-time-factor measurement that motivates such a
 * change says nothing about memory.
 */
export const MAX_TURN_BYTES =
  MAX_SAMPLE_RATE * INBOUND_CHANNELS * 2 * MAX_TURN_SECONDS;

/**
 * The inbound audio of one turn, and everything derived from its sample rate.
 *
 * Only constructible once a rate is known, which is what makes `sampleRate`
 * plain rather than nullable: the turn holds no buffer at all until its first
 * frame fixes the rate, so there is no state in which bytes exist without one.
 * The rate used to be nullable and defaulted at three separate call sites, and
 * a default that only ever ran when the code was already wrong is a bug that
 * reports the wrong duration instead of failing.
 */
export class TurnAudio {
  private readonly chunks: Buffer[] = [];
  private bytes = 0;

  constructor(readonly sampleRate: number) {}

  get byteLength(): number {
    return this.bytes;
  }

  /** No bytes yet — a frame may carry an empty payload and still fix the rate. */
  get isEmpty(): boolean {
    return this.bytes === 0;
  }

  get bytesPerSecond(): number {
    return this.sampleRate * INBOUND_CHANNELS * 2;
  }

  /** How far into the turn, in seconds, a given byte offset sits. */
  secondsAt(byteOffset: number): number {
    return byteOffset / this.bytesPerSecond;
  }

  /**
   * Whether accepting `incoming` more bytes would pass the turn's ceiling.
   *
   * Deliberately not derived from {@link bytesPerSecond}: that number comes from
   * the rate the client reported, and the cap must not.
   */
  wouldExceedCap(incoming: number): boolean {
    return this.bytes + incoming > MAX_TURN_BYTES;
  }

  append(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.bytes += chunk.length;
  }

  /**
   * The turn's raw PCM from an offset onward, with no container.
   *
   * For the causal decoding path, which is fed the audio ONCE and keeps its own
   * decoder state, so it wants only what it has not seen. Wrapping each 300ms
   * of that in a WAV header and stripping it again on the other side would be
   * work at both ends for a format neither wants — and a header mid-stream is
   * not merely wasteful, it is wrong: the session is one continuous utterance,
   * not a sequence of little files.
   */
  pcmFrom(fromByte: number): Buffer {
    if (fromByte >= this.bytes) return Buffer.alloc(0);
    // Walks to the offset rather than concatenating the turn. The naive version
    // copied the whole buffer on every feed — 1.4MB at the 45s ceiling, ~150
    // times a turn, across every concurrent turn — to hand back the last 10KB
    // of it.
    let skip = fromByte;
    const parts: Buffer[] = [];
    for (const chunk of this.chunks) {
      if (skip >= chunk.length) {
        skip -= chunk.length;
        continue;
      }
      parts.push(skip > 0 ? chunk.subarray(skip) : chunk);
      skip = 0;
    }
    return parts.length === 1 ? parts[0]! : Buffer.concat(parts);
  }

  /**
   * Concatenate the turn's frames into the container the STT sidecar needs.
   *
   * `fromByte` lets the live transcript read only the newest stretch of a long
   * turn; the final decode always passes 0 and reads the whole thing.
   */
  toWav(fromByte = 0): Buffer {
    const samples = Buffer.concat(this.chunks);
    // PyAV opens a container, so the raw frames need a header before the
    // sidecar will decode them.
    return encodePcm16Wav({
      samples: fromByte > 0 ? samples.subarray(fromByte) : samples,
      sampleRate: this.sampleRate,
      channels: INBOUND_CHANNELS,
    });
  }
}
