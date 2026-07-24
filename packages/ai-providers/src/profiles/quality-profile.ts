// Quality profile resolver — maps the continuous speed↔quality dial (0..1) to
// concrete provider model tiers. Single source of truth for model IDs.
//
// The top tier signals "premium" via the higher-fidelity `eleven_multilingual_v2`
// voice, not a heavier translate model — a heavier model is quota-gated and
// yields no translation-quality gain here. Quality is driven by VOICE choice.
// STT is single-model (slider-independent).
//
// The translate model is chosen by QUOTA rather than by tier, because the free
// tier meters daily requests per project per model
// (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`). Measured on this
// project's key: the 2.5 Flash family allows 20 requests/day — low enough that
// one demo session exhausts it — while each 3.x Flash-Lite allows 500 and Gemma
// allows 14,400. The ordered list below is therefore ~1,000 fast requests/day
// (measured 0.7–1.0s per sentence) before a slow but very deep reserve
// (measured 7–9s per sentence). Because the quota is per model, exhausting one
// entry leaves the next untouched.
const TRANSLATION_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-31b-it'];

/** Resolved model selection for one translation turn. */
export interface QualityProfile {
  /** ElevenLabs Scribe STT model. */
  sttModel: string;
  /** Translation models to try in order as each one's daily quota runs out. */
  translationModels: string[];
  /** ElevenLabs TTS model. */
  ttsModel: string;
}

/** Optional per-deployment overrides (e.g. pin a different STT model). */
export interface QualityProfileOverrides {
  sttModel?: string;
}

/**
 * Buckets the continuous quality value into three tiers.
 * Input is clamped to [0, 1] so out-of-range callers cannot select an
 * undefined tier.
 */
export function resolveQualityProfile(
  quality: number,
  overrides?: QualityProfileOverrides,
): QualityProfile {
  const q = Math.min(1, Math.max(0, quality));
  const sttModel = overrides?.sttModel ?? 'scribe_v2';
  const translationModels = [...TRANSLATION_MODELS];

  if (q < 0.34) {
    return { sttModel, translationModels, ttsModel: 'eleven_flash_v2_5' };
  }
  if (q < 0.67) {
    return { sttModel, translationModels, ttsModel: 'eleven_turbo_v2_5' };
  }
  return { sttModel, translationModels, ttsModel: 'eleven_multilingual_v2' };
}
