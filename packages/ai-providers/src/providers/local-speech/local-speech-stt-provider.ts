// Local speech-to-text — Vietnamese + English transcription via the local
// sherpa-onnx sidecar (services/local-stt). POSTs the audio as multipart and
// returns the transcript. Uses global fetch/FormData/Blob (Node 18+/22), no
// SDK dependency.
//
// The sidecar picks the engine from `language`, and for Vietnamese also from the
// role: an unnamed request gets the accurate recogniser, `openStream` gets the
// causal one. English has a single engine and no session support.
import type { LanguageCode } from '../../interfaces/provider-types.js';
import type {
  SttProvider,
  SttStreamSession,
  SttTranscribeOptions,
  SttTranscriptResult,
} from '../../interfaces/stt-provider.js';
import {
  ProviderConfigError,
  ProviderConnectionError,
  ProviderResponseError,
} from '../../errors/provider-errors.js';
import { extFromMime, truncate } from '../http-util.js';

export interface LocalSpeechSttConfig {
  /** Base URL of the sidecar, e.g. `http://localhost:8002`. */
  baseUrl?: string;
}

interface TranscribeResponse {
  text?: string;
  language?: string;
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
    // Named only when the caller has a role in mind. Sending nothing is what
    // asks for the language's default, and the sidecar rejects a name it does
    // not serve rather than quietly substituting one.
    if (options?.engine) form.append('engine', options.engine);
    // Copy into a fresh ArrayBuffer-backed view so the bytes satisfy BlobPart
    // regardless of the caller's backing buffer (TS typed-array generics).
    const fileBlob = new Blob([new Uint8Array(audio)], { type: mimeType });
    form.append('file', fileBlob, `audio.${extFromMime(mimeType)}`);

    const json = await this.call<TranscribeResponse>('/transcribe', {
      method: 'POST',
      body: form,
    });
    if (typeof json.text !== 'string') {
      throw new ProviderResponseError('Local STT returned an unexpected response');
    }
    // An empty transcript is a legitimate result (silence); the pipeline turns
    // it into a "no speech detected" error, so it is not this layer's concern.
    return { text: json.text, language };
  }

  /**
   * Open a causal decoding session on the sidecar.
   *
   * Rejects rather than degrading when the language's engine decodes whole
   * utterances only (HTTP 409). The caller is opening this because it intends to
   * SPEAK what comes back, and a silent fallback to re-decoding would hand it
   * text a later read can revise — the exact failure this path exists to remove.
   */
  async openStream(language: LanguageCode): Promise<SttStreamSession> {
    const form = new FormData();
    form.append('language', language);
    const json = await this.call<{ stream_id?: string }>('/stream', {
      method: 'POST',
      body: form,
    });
    if (typeof json.stream_id !== 'string') {
      throw new ProviderResponseError('Local STT returned no stream id');
    }
    return new LocalSttStreamSession(this, json.stream_id);
  }

  /**
   * One request against the sidecar, with its failures named consistently.
   *
   * @internal — public only so a session opened by this provider can keep using
   * it. Not part of the `SttProvider` contract.
   */
  async call<T>(path: string, init: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, init);
    } catch (err) {
      throw new ProviderConnectionError('Local STT request failed', err);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ProviderResponseError(
        `Local STT returned ${res.status}: ${truncate(detail)}`,
        res.status,
      );
    }
    const json = (await res.json().catch(() => null)) as T | null;
    if (json === null) {
      throw new ProviderResponseError('Local STT returned an unexpected response');
    }
    return json;
  }
}

/**
 * One open session on the sidecar.
 *
 * Holds no audio and no transcript: the decoder state lives across the wire and
 * the running text belongs to whoever is appending it. What this owns is the id
 * and the promise that it gets released.
 */
class LocalSttStreamSession implements SttStreamSession {
  private closed = false;

  constructor(
    private readonly provider: LocalSpeechSttProvider,
    private readonly id: string,
  ) {}

  async feed(chunk: Uint8Array): Promise<string> {
    const json = await this.provider.call<{ text?: string }>(`/stream/${this.id}/feed`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      // Copied into a fresh view for the same reason `transcribe` does it:
      // the caller's backing buffer may be a slice of a larger one.
      body: new Uint8Array(chunk),
    });
    return typeof json.text === 'string' ? json.text : '';
  }

  async finalize(): Promise<string> {
    const json = await this.provider.call<{ text?: string }>(`/stream/${this.id}/finalize`, {
      method: 'POST',
    });
    return typeof json.text === 'string' ? json.text : '';
  }

  /**
   * Idempotent locally, but the FIRST close still reports a failure.
   *
   * Teardown paths run more than once — a turn that ends and a socket that drops
   * both want this — so a second call must be free. A first call that finds
   * nothing there is different: the session leaked or was reaped, and swallowing
   * that would hide the one condition worth knowing about.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.provider.call(`/stream/${this.id}`, { method: 'DELETE' });
  }
}
