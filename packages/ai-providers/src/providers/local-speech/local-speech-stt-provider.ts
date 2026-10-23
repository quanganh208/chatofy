// Local speech-to-text — Vietnamese + English transcription via the local
// sherpa-onnx sidecar (services/local-stt). POSTs the audio as multipart and
// returns the transcript. Uses global fetch/FormData/Blob (Node 18+/22), no
// SDK dependency.
//
// The sidecar picks the engine from `language` (Zipformer for vi, Parakeet for
// en), so this provider serves every language pair through one backend name.
import type { LanguageCode } from '../../interfaces/provider-types.js';
import type {
  ServedLanguages,
  SttProvider,
  SttTranscribeOptions,
  SttTranscriptResult,
} from '../../interfaces/stt-provider.js';
import {
  ProviderConfigError,
  ProviderConnectionError,
  ProviderResponseError,
} from '../../errors/provider-errors.js';
import {
  extFromMime,
  fetchWithDeadline,
  LOCAL_HEALTHZ_TIMEOUT_MS,
  LOCAL_STT_TIMEOUT_MS,
  truncate,
} from '../http-util.js';
import { readServedLanguages } from './served-languages.js';

export interface LocalSpeechSttConfig {
  /** Base URL of the sidecar, e.g. `http://localhost:8002`. */
  baseUrl?: string;
}

interface TranscribeResponse {
  text?: string;
  language?: string;
  languageConfidence?: unknown;
  lidSpeechMs?: unknown;
  speechMs?: number;
  pauses?: unknown;
  leadPause?: unknown;
  alternates?: unknown;
}

const isPause = (ms: unknown): ms is number =>
  typeof ms === 'number' && Number.isFinite(ms) && ms >= 0;

/** The sidecar's pauses, only when they are one non-negative number per word. */
function pausesFor(text: string, pauses: unknown): number[] | undefined {
  if (!Array.isArray(pauses)) return undefined;
  const words = text.split(/\s+/).filter(Boolean).length;
  const valid = pauses.every(isPause);
  return valid && pauses.length === words ? (pauses as number[]) : undefined;
}

/**
 * The status the sidecar answers `candidates` with when it has language
 * identification switched off. Any other failure is a failure; this one means
 * "decode it the declared way instead", and is answered that way.
 */
const IDENTIFY_UNAVAILABLE_STATUS = 409;

/** The language the sidecar identified, when it is one of `candidates` and it said how sure. */
function identifiedLanguage(
  json: TranscribeResponse,
  candidates: readonly LanguageCode[],
): { language: LanguageCode; languageConfidence: number | null; lidSpeechMs?: number } | null {
  const language = candidates.find((candidate) => candidate === json.language);
  if (language === undefined) return null;
  const confidence = json.languageConfidence;
  // `null` is the sidecar saying it decided but cannot say how surely; absent
  // is a sidecar that never decided at all and echoed the request back.
  if (confidence !== null && !(typeof confidence === 'number' && Number.isFinite(confidence))) {
    return null;
  }
  return {
    language,
    languageConfidence: confidence,
    ...(isPause(json.lidSpeechMs) ? { lidSpeechMs: json.lidSpeechMs } : {}),
  };
}

export class LocalSpeechSttProvider implements SttProvider {
  readonly name = 'local';
  private readonly baseUrl: string;

  constructor(config: LocalSpeechSttConfig) {
    if (!config.baseUrl) {
      throw new ProviderConfigError('Local STT requires a baseUrl');
    }
    // Trim a trailing slash so `${baseUrl}/transcribe` never doubles up.
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  async transcribe(
    audio: Uint8Array,
    mimeType: string,
    language: LanguageCode,
    options?: SttTranscribeOptions,
  ): Promise<SttTranscriptResult> {
    // De-duplicated, and sent only when there is a choice to make: one
    // candidate is the declared language, which `language` already says.
    const candidates = [...new Set(options?.candidates ?? [])];
    const identifying = candidates.length >= 2;

    let res = await this.post(
      this.form(audio, mimeType, language, options, identifying ? candidates : []),
    );
    let refused = false;
    if (identifying && res.status === IDENTIFY_UNAVAILABLE_STATUS) {
      // Identification was switched off under a caller that still believed it
      // on. The turn is still decodable in its declared language, so it is
      // decoded again that way — once, without candidates — rather than lost,
      // and the caller is told so it stops offering candidates.
      refused = true;
      options?.onIdentifyUnavailable?.();
      res = await this.post(this.form(audio, mimeType, language, options, []));
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ProviderResponseError(
        `Local STT returned ${res.status}: ${truncate(detail)}`,
        res.status,
      );
    }

    const json = (await res.json().catch(() => null)) as TranscribeResponse | null;
    if (!json || typeof json.text !== 'string') {
      throw new ProviderResponseError('Local STT returned an unexpected response');
    }
    // Trusted only when the sidecar named one of the languages it was offered
    // AND reported a confidence for it. A sidecar from before identification
    // ignores the field and echoes the declared language with no confidence,
    // which is a declared decode and must read as one.
    const identified = identifying && !refused ? identifiedLanguage(json, candidates) : null;
    const result = this.result(json, json.text, identified?.language ?? language);
    if (!identifying) return result;
    return identified
      ? { ...result, identified: true, ...identified }
      : { ...result, identified: false };
  }

  private post(form: FormData): Promise<Response> {
    return fetchWithDeadline(
      `${this.baseUrl}/transcribe`,
      { method: 'POST', body: form },
      LOCAL_STT_TIMEOUT_MS,
      'Local STT request',
    );
  }

  /** One request's body. Built per attempt: a sent `FormData` is not reusable. */
  private form(
    audio: Uint8Array,
    mimeType: string,
    language: LanguageCode,
    options: SttTranscribeOptions | undefined,
    candidates: readonly LanguageCode[],
  ): FormData {
    const form = new FormData();
    form.append('language', language);
    // One field per term rather than one delimited field: the sidecar joins them
    // with the separator its decoder expects, and a term that happens to contain
    // that separator is then its problem to fold rather than a term that
    // silently became two on the way over.
    //
    // Sent for every language, and dropped on the far side by an engine that
    // cannot bias — the sidecar owns which of its two models that is, and
    // teaching this provider the same thing would be the second place to update.
    for (const term of options?.hotwords ?? []) {
      if (term.trim()) form.append('hotwords', term);
    }
    // Only when > 0: the sidecar's own field default is 0 (no gate), so an
    // absent or zero floor sends nothing rather than a redundant `0`.
    if (options?.minSpeechMs && options.minSpeechMs > 0) {
      form.append('min_speech_ms', String(options.minSpeechMs));
    }
    if (options?.alternates) form.append('alternates', 'true');
    // One field per language, like `hotwords`, and only when there is a choice.
    for (const candidate of candidates) form.append('candidates', candidate);
    // Copy into a fresh ArrayBuffer-backed view so the bytes satisfy BlobPart
    // regardless of the caller's backing buffer (TS typed-array generics).
    const fileBlob = new Blob([new Uint8Array(audio)], { type: mimeType });
    form.append('file', fileBlob, `audio.${extFromMime(mimeType)}`);
    return form;
  }

  private result(
    json: TranscribeResponse,
    text: string,
    language: LanguageCode,
  ): SttTranscriptResult {
    // An empty transcript is a legitimate result (silence); the pipeline turns
    // it into a "no speech detected" error, so it is not this layer's concern.
    //
    // `speechMs` rides along only when the sidecar measured it (`min_speech_ms`
    // was sent and > 0); an older sidecar or an ungated request simply omits
    // the field, and `typeof` keeps a stray non-number in the JSON from being
    // passed on as if it were the sidecar's own answer.
    const pauses = pausesFor(text, json.pauses);
    // Kept only as a list of non-blank strings: anything else is a sidecar
    // this provider does not understand, and no alternate is the safe answer.
    const alternates = Array.isArray(json.alternates)
      ? json.alternates.filter((alt): alt is string => typeof alt === 'string' && alt.trim() !== '')
      : [];
    return {
      text,
      language,
      ...(typeof json.speechMs === 'number' ? { speechMs: json.speechMs } : {}),
      ...(pauses === undefined ? {} : { pauses }),
      ...(pauses !== undefined && isPause(json.leadPause) ? { leadPause: json.leadPause } : {}),
      ...(alternates.length > 0 ? { alternates } : {}),
    };
  }

  /**
   * The registry languages `/healthz` reports this sidecar recognising.
   *
   * Rejects rather than resolving `[]` when the sidecar cannot be reached or
   * has not said — an empty *resolved* list would read as "recognises
   * nothing", which is never true of a running sidecar. The caller
   * (`SpeechLanguageSupport`) treats a rejection as "not known right now" and
   * refuses no turn on account of it.
   */
  async supportedLanguages(): Promise<ServedLanguages> {
    const served = await readServedLanguages(this.baseUrl, LOCAL_HEALTHZ_TIMEOUT_MS);
    if (!served) {
      throw new ProviderConnectionError('Local STT did not report which languages it serves');
    }
    return served;
  }
}
