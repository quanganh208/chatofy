// Speaker embeddings from the local sherpa-onnx sidecar (services/local-stt),
// over the same localhost hop as transcription but through its own endpoint —
// see POST /embed there for why the two are not one request.
//
// Mirrors LocalSpeechSttProvider's error classes and URL handling so a sidecar
// that is down, slow or upset reports itself the same way whichever endpoint was
// being called.
import type {
  SpeakerEmbeddingProvider,
  SpeakerEmbeddingResult,
} from '../../interfaces/speaker-embedding-provider.js';
import { ProviderConfigError, ProviderResponseError } from '../../errors/provider-errors.js';
import { extFromMime, fetchWithDeadline, LOCAL_EMBED_TIMEOUT_MS, truncate } from '../http-util.js';

export interface LocalSpeechEmbeddingConfig {
  /** Base URL of the sidecar, e.g. `http://localhost:8002`. */
  baseUrl?: string;
}

interface EmbedResponse {
  vector?: unknown;
  dim?: unknown;
  speechMs?: unknown;
}

export class LocalSpeechEmbeddingProvider implements SpeakerEmbeddingProvider {
  readonly name = 'local';
  private readonly baseUrl: string;

  constructor(config: LocalSpeechEmbeddingConfig) {
    if (!config.baseUrl) {
      throw new ProviderConfigError('Local speaker embedding requires a baseUrl');
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  async embed(audio: Uint8Array, mimeType: string): Promise<SpeakerEmbeddingResult> {
    const form = new FormData();
    // Copied into a fresh view for the same reason the STT provider does it:
    // BlobPart does not accept every typed-array backing buffer.
    form.append(
      'file',
      new Blob([new Uint8Array(audio)], { type: mimeType }),
      `audio.${extFromMime(mimeType)}`,
    );

    const res = await fetchWithDeadline(
      `${this.baseUrl}/embed`,
      { method: 'POST', body: form },
      LOCAL_EMBED_TIMEOUT_MS,
      'Local speaker embedding request',
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ProviderResponseError(
        `Local speaker embedding returned ${res.status}: ${truncate(detail)}`,
        res.status,
      );
    }

    const json = (await res.json().catch(() => null)) as EmbedResponse | null;
    const vector = json?.vector;
    // Checked rather than cast. A silently empty vector would score 0 against
    // every centroid, which reads downstream as "nobody recognised" — a plausible
    // answer, and the wrong one.
    if (
      !Array.isArray(vector) ||
      vector.length === 0 ||
      !vector.every((v) => typeof v === 'number')
    ) {
      throw new ProviderResponseError('Local speaker embedding returned no usable vector');
    }
    return {
      vector: vector as number[],
      dim: typeof json?.dim === 'number' ? json.dim : vector.length,
      // Missing reads as 0, and 0 is below every floor a consumer can set — so a
      // sidecar too old to measure this withholds the turn rather than having it
      // placed on a number nobody supplied. Not a rejection like the vector
      // check above: a sidecar that cannot say how much speech it heard should
      // cost a label, not the turn it belongs to.
      speechMs: typeof json?.speechMs === 'number' ? json.speechMs : 0,
    };
  }
}
