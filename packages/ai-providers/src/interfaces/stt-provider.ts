// SttProvider contract — speech-to-text. Batch transcription is the required
// core (turn-based flow); streaming is an optional future path. Mirrors the
// TtsProvider shape (required batch method + optional stream method).
import type { AudioFormat, LanguageCode, ProviderConfig, StreamHandle } from './provider-types.js';

export interface SttProviderConfig extends ProviderConfig {
  apiKey?: string;
  model?: string;
}

/** Result of transcribing a complete utterance. */
export interface SttTranscriptResult {
  text: string;
  language: LanguageCode;
  /**
   * How much of the audio the backend's own speech detector measured as
   * speech, in ms — set only by a backend that ran one (the local sidecar,
   * when `minSpeechMs` was passed). Undefined from a backend that has no such
   * detector (ElevenLabs) or from a local sidecar that predates the field.
   *
   * This is what lets a caller tell "the gate refused this turn" from "the
   * recognizer decoded and simply heard nothing": both produce an empty
   * `text`, and only this field says which. See `NoSpeechDetectedException`
   * in `apps/api/.../pipeline-translator.service.ts` for the one place the
   * distinction changes behaviour.
   */
  speechMs?: number;
}

/** Streaming partial/final transcript event (future realtime path). */
export interface SttTranscriptEvent {
  text: string;
  isFinal: boolean;
  language: LanguageCode;
}

/** Per-utterance knobs a backend may honour, or ignore when it cannot. */
export interface SttTranscribeOptions {
  /**
   * Terms the recognizer is likely to get wrong, to bias decoding towards.
   *
   * The same list `TranslationHints.hotwords` carries to the translator, which
   * is deliberate rather than convenient: the field's whole premise is that the
   * recognizer mishears these words, so the recognizer is the first place it
   * should be spent. Passing it on to the translator as well covers the term the
   * biasing still misses.
   *
   * Optional for the backend, not for the caller: a provider that cannot bias
   * its decoder ignores this rather than failing, so a call site must not read a
   * silent pass-through as the terms having been applied.
   */
  hotwords?: string[];
  /**
   * Silero speech floor, in ms, below which the backend should answer an empty
   * transcript without decoding.
   *
   * Optional for the backend, exactly like {@link hotwords}: a provider that
   * cannot gate on speech (ElevenLabs) ignores it rather than failing, and a
   * caller must not read the silent pass-through as the floor having been
   * applied. `0` or absent both mean "no floor" — the caller decides which of
   * the two it sends.
   */
  minSpeechMs?: number;
}

/**
 * What a backend reports serving, split by whether the registry names it.
 *
 * `unknown` carries the tags the backend sent that name NO registry language —
 * raw, for the caller to report. The provider does not log them itself: it is
 * asked on a timer, and only the caller can remember what it already said.
 */
export interface ServedLanguages {
  /** Registry languages served, de-duplicated. Never empty on a resolved call. */
  known: readonly LanguageCode[];
  /** Tags the backend reported that the registry does not know, de-duplicated. */
  unknown: readonly string[];
}

export interface SttProvider {
  readonly name: string;
  /** Batch transcription of a complete utterance — the turn-based core. */
  transcribe(
    audio: Uint8Array,
    mimeType: string,
    language: LanguageCode,
    options?: SttTranscribeOptions,
  ): Promise<SttTranscriptResult>;
  /**
   * Which registry languages this backend can actually recognise right now.
   *
   * OPTIONAL, and its absence is meaningful: a cloud provider with no
   * per-language restriction implements nothing here, and is therefore never
   * the reason a turn is refused — parity between a backend and the registry
   * is ⊆, not =. A provider that DOES implement this (the local sidecar) may
   * reject the call itself when it cannot answer right now (unreachable, or
   * deployed before this existed); a caller must treat that the same as "no
   * restriction known" rather than as "serves nothing".
   */
  supportedLanguages?(): Promise<ServedLanguages>;
  /** Optional streaming variant — partials delivered via callback. */
  startStream?(
    language: LanguageCode,
    audioFormat: AudioFormat,
    onTranscript: (event: SttTranscriptEvent) => void,
  ): Promise<StreamHandle>;
  pushAudio?(handle: StreamHandle, chunk: Uint8Array): Promise<void>;
}
