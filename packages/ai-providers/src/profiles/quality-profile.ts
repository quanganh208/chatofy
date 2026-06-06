// Quality profile resolver — maps the continuous speed↔quality dial (0..1) to
// concrete provider model tiers. Single source of truth for model IDs.
//
// Research finding: thinking adds latency without quality benefit for
// translation, so thinking stays disabled (budget 0) across all tiers. The top
// tier signals "premium" via the higher-fidelity `eleven_multilingual_v2` voice,
// not a heavier translate model — `gemini-2.5-pro` is quota-gated and yields no
// translation-quality gain here. Quality is driven by VOICE + MODEL choice, not
// thinking. STT is single-model (slider-independent).

/** Resolved model selection for one translation turn. */
export interface QualityProfile {
  /** ElevenLabs Scribe STT model. */
  sttModel: string;
  /** Gemini translation model. */
  translationModel: string;
  /** Gemini thinking budget: 0 = off, -1 = dynamic. */
  thinkingBudget: number;
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

  if (q < 0.34) {
    return {
      sttModel,
      translationModel: 'gemini-2.5-flash-lite',
      thinkingBudget: 0,
      ttsModel: 'eleven_flash_v2_5',
    };
  }
  if (q < 0.67) {
    return {
      sttModel,
      translationModel: 'gemini-2.5-flash',
      thinkingBudget: 0,
      ttsModel: 'eleven_turbo_v2_5',
    };
  }
  return {
    sttModel,
    translationModel: 'gemini-2.5-flash',
    thinkingBudget: 0,
    ttsModel: 'eleven_multilingual_v2',
  };
}
