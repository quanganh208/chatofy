import type { LanguageCode, SessionOptions, VoiceGender } from '@chatofy/types';

/**
 * How one language of a turn is spoken, resolved from what the client sent.
 *
 * Per language because a reader may hear one side of a two-way conversation and
 * not the other, and because the two engines differ: a rate the English engine
 * honours the Vietnamese one ignores, so one rate for both was a setting that
 * applied to half the conversation.
 */
export interface LanguageVoice {
  /** Whether a translation into this language is synthesized at all. */
  readonly speak: boolean;
  readonly speed: number;
  readonly gender: VoiceGender;
  /** An opaque token of this language's engine, when one was named. */
  readonly voice?: string;
}

/** The fields this resolution reads — a start's options, or a turn's copy of them. */
export type LanguageVoiceOptions = Pick<
  SessionOptions,
  | 'voiceOutput'
  | 'speed'
  | 'voiceGender'
  | 'voice'
  | 'voices'
  | 'voiceByLanguage'
  | 'languagePair'
>;

/**
 * Resolve `language`'s voice, field by field: its own entry in
 * `voiceByLanguage`, then the flat field, then the server's default.
 *
 * The flat fields are what every client sent before per-language settings
 * existed — mobile, the extension and a meeting leg still send only those — so
 * falling back to them per FIELD, not per entry, is what keeps such a client
 * running exactly as it did. An entry that names only `speak` still takes its
 * rate from the flat `speed`.
 *
 * The flat `voice` is a token of the DECLARED target's engine — the language a
 * declared turn speaks, and the one clients have always picked it for — and
 * nothing else. Not "whatever this turn speaks first": a two-way turn heard in
 * the target is spoken in the source, and handing it the target's token would
 * ask one engine for the other's speaker id.
 */
export function resolveLanguageVoice(
  options: LanguageVoiceOptions,
  language: LanguageCode,
): LanguageVoice {
  const own = options.voiceByLanguage?.[language];
  const voice =
    own?.voice ??
    options.voices?.[language] ??
    (language === options.languagePair.target ? options.voice : undefined);
  return {
    speak: own?.speak ?? options.voiceOutput ?? true,
    speed: own?.speed ?? options.speed ?? 1,
    gender: own?.gender ?? options.voiceGender,
    ...(voice === undefined ? {} : { voice }),
  };
}

/**
 * The languages a start may end up speaking, before any turn has been heard:
 * both sides of a two-way pair, the target of anything else, and the extra
 * targets of a declared one-way start (the only kind that honours them).
 *
 * Used to price admission at its upper bound — see the gateway — so it errs
 * toward listing a language rather than leaving one out.
 */
export function languagesAStartMaySpeak(
  options: Pick<
    SessionOptions,
    'languagePair' | 'twoWay' | 'alsoTranslateInto'
  >,
): LanguageCode[] {
  const { source, target } = options.languagePair;
  if (source === 'detect') return [target];
  if (options.twoWay) return [target, source];
  return [target, ...(options.alsoTranslateInto ?? [])];
}
