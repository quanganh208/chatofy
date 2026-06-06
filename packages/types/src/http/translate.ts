// Translate HTTP contracts — schema-first. Turn-based (record full utterance →
// POST → response) Vietnamese→English voice translation. Audio travels as base64
// inside the standard ApiResponse<T> envelope. V1: vi→en only.
import { z } from 'zod';

/** POST /translate request body. */
export const translateRequestSchema = z.object({
  /** Base64-encoded recorded audio bytes (no data-url prefix). */
  audioBase64: z.string().min(1),
  /** MIME type of the recorded audio, e.g. "audio/webm". */
  audioMimeType: z.string().min(1),
  /**
   * Speed↔quality dial: 0.0 = fastest/cheapest models, 1.0 = highest quality.
   * Mapped to provider model tiers server-side.
   */
  quality: z.number().min(0).max(1).default(0.5),
});
export type TranslateRequest = z.infer<typeof translateRequestSchema>;

/** POST /translate success payload (inner data of the response envelope). */
export const translateResponseSchema = z.object({
  /** Recognised Vietnamese transcript. */
  sourceText: z.string(),
  /** English translation. */
  targetText: z.string(),
  /** Base64-encoded synthesized English audio (no data-url prefix). */
  audioBase64: z.string(),
  /** MIME type of the returned audio, e.g. "audio/mpeg". */
  audioMimeType: z.string(),
  /** Resolved/clamped quality value actually used. */
  quality: z.number().min(0).max(1),
});
export type TranslateResponse = z.infer<typeof translateResponseSchema>;
