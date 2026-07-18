// AudioFrame envelope — typed wrapper for raw audio chunks sent over WebSocket
import { z } from 'zod';

export const audioEncodingSchema = z.enum(['pcm16', 'opus', 'mulaw']);

export type AudioEncoding = z.infer<typeof audioEncodingSchema>;

/** Binary audio chunk transmitted in a WebSocket audio.frame event. */
export const audioFrameSchema = z.object({
  /** ID of the conversation session this frame belongs to. */
  sessionId: z.string(),
  encoding: audioEncodingSchema,
  /** Samples per second, e.g. 16000, 24000, 48000. */
  sampleRate: z.number().int().positive(),
  /** Monotonically increasing frame counter for ordering / loss detection. */
  sequence: z.number().int().nonnegative(),
  /** Unix epoch milliseconds when the frame was captured. */
  timestamp: z.number().int().nonnegative(),
  /** Base64-encoded raw audio bytes. */
  payload: z.string(),
});

export type AudioFrame = z.infer<typeof audioFrameSchema>;
