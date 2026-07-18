// Translate HTTP contracts — schema-first. Turn-based (record full utterance →
// POST → response) voice translation. Audio travels as base64 inside the standard
// ApiResponse<T> envelope. Directions: vi→en (ElevenLabs voice) and en→vi (VieNeu voice).
import { z } from 'zod';
// Reuse the CANONICAL direction enum (vi_to_en | en_to_vi) from the domain layer
// instead of redeclaring it here.
import { translationDirectionSchema, type TranslationDirection } from '../domain/transcript.js';

/** Source/target language codes for a translation direction. */
export function directionLanguages(direction: TranslationDirection): {
  source: 'vi' | 'en';
  target: 'vi' | 'en';
} {
  return direction === 'en_to_vi' ? { source: 'en', target: 'vi' } : { source: 'vi', target: 'en' };
}

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
  /**
   * Translation direction. Optional for backward compatibility — the server
   * defaults an omitted direction to vi→en.
   */
  direction: translationDirectionSchema.optional(),
  /**
   * Optional voice for the output speech. Only applied for en→vi (VieNeu preset
   * name); ignored for vi→en (ElevenLabs uses its configured voice).
   */
  voice: z.string().optional(),
});
export type TranslateRequest = z.infer<typeof translateRequestSchema>;

/**
 * VieNeu preset voice names selectable for en→vi output.
 * Static mirror of the sidecar's built-in presets — the sidecar's GET /voices
 * endpoint remains the runtime source of truth; keep this list in sync with it.
 */
export const VIENEU_VOICES = [
  'Trúc Ly',
  'Phạm Tuyên',
  'Thái Sơn',
  'Xuân Vĩnh',
  'Thanh Bình',
  'Minh Đức',
  'Ngọc Linh',
  'Đoan Trang',
  'Mai Anh',
  'Thục Đoan',
  'Minh Triết',
  'Thùy Dung',
  'Quang Sơn',
  'Ngọc Trân',
] as const;

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
