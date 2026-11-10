import { z } from 'zod';

/**
 * The three processors a browser or platform applies to the microphone.
 *
 * The field names are the W3C MediaTrackConstraints names on purpose: on the
 * web this object IS the `audio` constraint, with no translation layer.
 * All on by default, the configuration every recorded measurement used.
 */
export const micProcessingSchema = z.object({
  echoCancellation: z.boolean(),
  noiseSuppression: z.boolean(),
  autoGainControl: z.boolean(),
});

export type MicProcessing = z.infer<typeof micProcessingSchema>;

export const DEFAULT_MIC_PROCESSING: Readonly<MicProcessing> = Object.freeze({
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
});
