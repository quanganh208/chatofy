// AudioFrame envelope — typed wrapper for raw audio chunks sent over WebSocket
import { z } from 'zod';

export const audioEncodingSchema = z.enum(['pcm16', 'opus', 'mulaw']);

export type AudioEncoding = z.infer<typeof audioEncodingSchema>;

/**
 * Narrowest and widest sample rates this contract carries.
 *
 * Bounded rather than merely positive because the server sizes a turn's memory
 * budget from the rate the client reports: an unbounded value would let one
 * unauthenticated socket claim an arbitrarily large buffer. Telephony's 8 kHz is
 * the floor, and 48 kHz is the highest rate browsers capture at.
 *
 * The ceiling this feeds is per TURN, and one socket may now hold several turns
 * at once — so what a single connection can pin is that ceiling times the
 * concurrency limit. The server states the product explicitly rather than leaving
 * it to be inferred; see `MAX_BUFFERED_BYTES_PER_SOCKET`.
 */
export const MIN_SAMPLE_RATE = 8000;
export const MAX_SAMPLE_RATE = 48000;

/** Binary audio chunk transmitted in a WebSocket audio.frame event. */
export const audioFrameSchema = z.object({
  /** ID of the conversation session this frame belongs to. */
  sessionId: z.string(),
  encoding: audioEncodingSchema,
  /** Samples per second, e.g. 16000, 24000, 48000. */
  sampleRate: z.number().int().min(MIN_SAMPLE_RATE).max(MAX_SAMPLE_RATE),
  /** Monotonically increasing frame counter for ordering / loss detection. */
  sequence: z.number().int().nonnegative(),
  /** Unix epoch milliseconds when the frame was captured. */
  timestamp: z.number().int().nonnegative(),
  /** Base64-encoded raw audio bytes. */
  payload: z.string(),
});

export type AudioFrame = z.infer<typeof audioFrameSchema>;
