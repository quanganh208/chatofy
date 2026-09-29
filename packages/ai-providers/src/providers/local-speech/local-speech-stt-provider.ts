// Local speech-to-text — Vietnamese + English transcription via the local
// sherpa-onnx sidecar (services/local-stt). POSTs the audio as multipart and
// returns the transcript. Uses global fetch/FormData/Blob (Node 18+/22), no
// SDK dependency.
//
// The sidecar picks the engine from `language` (Zipformer for vi, Parakeet for
// en), so this provider serves both directions through one backend name.
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
  speechMs?: number;
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
    // Copy into a fresh ArrayBuffer-backed view so the bytes satisfy BlobPart
    // regardless of the caller's backing buffer (TS typed-array generics).
    const fileBlob = new Blob([new Uint8Array(audio)], { type: mimeType });
    form.append('file', fileBlob, `audio.${extFromMime(mimeType)}`);

    const res = await fetchWithDeadline(
      `${this.baseUrl}/transcribe`,
      { method: 'POST', body: form },
      LOCAL_STT_TIMEOUT_MS,
      'Local STT request',
    );

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
    // An empty transcript is a legitimate result (silence); the pipeline turns
    // it into a "no speech detected" error, so it is not this layer's concern.
    //
    // `speechMs` rides along only when the sidecar measured it (`min_speech_ms`
    // was sent and > 0); an older sidecar or an ungated request simply omits
    // the field, and `typeof` keeps a stray non-number in the JSON from being
    // passed on as if it were the sidecar's own answer.
    return {
      text: json.text,
      language,
      ...(typeof json.speechMs === 'number' ? { speechMs: json.speechMs } : {}),
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
