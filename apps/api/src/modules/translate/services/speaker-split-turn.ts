import type {
  SpeakerEmbeddingResult,
  TranslationHints,
} from '@chatofy/ai-providers';
import type { TranslationDirection } from '@chatofy/types';
import type { TurnAudio } from '../session/turn-audio';
import type { Span } from '../session/speaker-change-split';
import type { PipelineTranslatorService } from './pipeline-translator.service';

/** One voice's share of a split turn, ready to be sent as its own final. */
export interface TranslatedPiece extends Span {
  sourceText: string;
  targetText: string;
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
 * two voices, or return null to fall back to the turn translated whole.
 *
 * Every piece is transcribed at once, then translated at once, so a split turn
 * costs about one extra round trip rather than one per piece. Each piece is
 * translated with the pieces before it as context, which is what the whole-turn
 * translation would have read them as.
 *
 * A piece the recognizer hears nothing in means the cut went wrong somewhere —
 * it would leave a speaker with an empty line — so the split is abandoned rather
 * than shipped with a hole in it, before any translation is paid for. Errors
 * propagate; the caller falls back.
 */
export async function translateSplitTurn(
  pipeline: Pick<
    PipelineTranslatorService,
    'transcribe' | 'translate' | 'embedSpeaker'
  >,
  audio: TurnAudio,
  spans: Span[],
  options: {
    direction: TranslationDirection;
    hints?: TranslationHints;
    models?: string[];
    /** Finished utterances from earlier turns on this connection, oldest first. */
    context: string[];
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
        direction: options.direction,
        hints: options.hints,
      }),
    ),
  );
  if (sources.some((text) => !text.trim())) return null;

  // Started once the split is certain, beside the translations. `embedSpeaker`
  // never rejects, so this cannot surface as an unhandled rejection.
  const vectors = Promise.all(
    wavs.map((wav) =>
      pipeline.embedSpeaker({ audio: wav, mimeType: 'audio/wav' }),
    ),
  );
  const targets = await Promise.all(
    sources.map((text, k) =>
      pipeline.translate({
        text,
        direction: options.direction,
        models: options.models,
        hints: options.hints,
        context: [...options.context, ...sources.slice(0, k)],
      }),
    ),
  );

  return {
    pieces: spans.map((span, k) => ({
      ...span,
      sourceText: sources[k]!,
      targetText: targets[k]!,
    })),
    vectors,
  };
}
