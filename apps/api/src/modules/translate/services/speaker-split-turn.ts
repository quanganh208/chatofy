import type { Logger } from '@nestjs/common';
import type {
  SpeakerEmbeddingResult,
  TranslationHints,
} from '@chatofy/ai-providers';
import type { TurnAudio } from '../session/turn-audio';
import type { Span } from '../session/speaker-change-split';
import type { PipelineTranslatorService } from './pipeline-translator.service';
import type {
  TurnLanguagePlan,
  TranslationMap,
} from '../session/turn-language-plan';

/** One voice's share of a split turn, ready to be sent as its own final. */
export interface TranslatedPiece extends Span {
  sourceText: string;
  translations: TranslationMap;
  /**
   * Whether this piece's span was the LAST one `planSpeakerSplit` cut — the
   * one whose `endMs` reaches the turn's own `durationMs`, not merely the
   * highest `endMs` among the pieces that survived being dropped.
   *
   * Carried through to the wire as `split.reachesEnd` so the client can place
   * the piece exactly, without guessing from wall-clock timestamps — see
   * `pieceCapture` in `packages/realtime-client/src/state/turn-keyed-transcript.ts`.
   */
  reachesEnd: boolean;
}

export interface SplitTurn {
  pieces: TranslatedPiece[];
  /**
   * Each piece's vector, in order, null where the sidecar gave none. A promise
   * rather than a field so the lines go out without waiting on it: a label may
   * wait on the sidecar, a sentence never does.
   */
  vectors: Promise<(SpeakerEmbeddingResult | null)[]>;
}

/**
 * Transcribe, translate and embed each piece of a turn that was split between
 * two voices, or return null when nothing in it survives.
 *
 * Every piece is transcribed at once, then translated at once, so a split turn
 * costs about one extra round trip rather than one per piece. Each piece is
 * translated with the SURVIVING pieces before it as context, which is what the
 * whole-turn translation would have read them as.
 *
 * A piece the recognizer hears nothing in — silence, or a music bed under the
 * caller's speech floor — is dropped, along with its span and its wav, before
 * anything past that point is paid for: no vector, no translation. This is a
 * gate finding correctly that a piece holds nothing to attribute, not a hole in
 * the split, so the survivors ship rather than the whole turn being abandoned
 * on their account. Only when EVERY piece comes back empty is there nothing
 * left to ship, and the caller falls back to the whole turn. Every other error
 * still propagates for the caller to fall back on.
 */
export async function translateSplitTurn(
  pipeline: Pick<
    PipelineTranslatorService,
    'transcribe' | 'translateAll' | 'embedSpeaker'
  >,
  audio: TurnAudio,
  spans: Span[],
  options: {
    plan: TurnLanguagePlan;
    hints?: TranslationHints;
    models?: string[];
    /** Finished utterances from earlier turns on this connection, oldest first. */
    context: string[];
    /** Silero speech floor passed to each piece's own transcription. */
    minSpeechMs?: number;
    /** Logs which piece was dropped and how long it was — never its text. */
    logger: Pick<Logger, 'warn'>;
  },
): Promise<SplitTurn | null> {
  const wavs = spans.map((span) =>
    audio.toWav(audio.byteAtMs(span.startMs), audio.byteAtMs(span.endMs)),
  );
  const sources = await Promise.all(
    wavs.map((wav) =>
      pipeline.transcribe({
        audio: wav,
        mimeType: 'audio/wav',
        language: options.plan.recognition,
        hints: options.hints,
        minSpeechMs: options.minSpeechMs,
      }),
    ),
  );

  // The span whose `endMs` reaches the turn's `durationMs` — always the last
  // one `planSpeakerSplit` produced, by construction. Read off the ORIGINAL
  // plan, before any piece is dropped, so a dropped trailing piece cannot
  // move which survivor is credited with reaching the end.
  const lastSpanEndMs = spans[spans.length - 1]!.endMs;

  const survivors = spans
    .map((span, index) => ({
      span,
      wav: wavs[index]!,
      source: sources[index]!,
    }))
    // A piece the recognizer heard nothing in is dropped on its TEXT alone —
    // the same rule as before `speechMs` existed. `speechMs` decides the
    // WHOLE-TURN fallback's banner (see `pipeline-translator.service.ts`);
    // here every dropped piece already logs why, so there is no separate
    // "gated vs empty" distinction worth making per piece.
    .filter(({ span, source }, index) => {
      if (source.text.trim()) return true;
      options.logger.warn(
        `speaker split: dropped piece ${index} (${span.endMs - span.startMs}ms), no speech heard`,
      );
      return false;
    });
  if (survivors.length === 0) return null;

  // Started once the split is certain, beside the translations. `embedSpeaker`
  // never rejects, so this cannot surface as an unhandled rejection.
  const vectors = Promise.all(
    survivors.map(({ wav }) =>
      pipeline.embedSpeaker({ audio: wav, mimeType: 'audio/wav' }),
    ),
  );
  // Each piece is fanned out to every one of the turn's targets, same as the
  // whole-turn path — a split turn must not lose the languages a listener
  // needs just because it also carried two voices. Context is the SURVIVING
  // pieces before this one, in order — a dropped piece said nothing, so it
  // cannot be context for the one after it.
  const survivorTexts = survivors.map(({ source }) => source.text);
  const translations = await Promise.all(
    survivorTexts.map((text, k) =>
      pipeline.translateAll({
        text,
        source: options.plan.recognition,
        targets: options.plan.targets,
        models: options.models,
        hints: options.hints,
        context: [...options.context, ...survivorTexts.slice(0, k)],
      }),
    ),
  );

  return {
    pieces: survivors.map(({ span }, k) => ({
      ...span,
      sourceText: survivorTexts[k]!,
      translations: translations[k]!,
      reachesEnd: span.endMs === lastSpanEndMs,
    })),
    vectors,
  };
}
