import type { DisplayRestoreOptions, DisplayRestorer } from '../../interfaces/display-restorer.js';
import { ProviderConfigError, ProviderResponseError } from '../../errors/provider-errors.js';
import { fetchWithDeadline, LOCAL_RESTORE_TIMEOUT_MS, truncate } from '../http-util.js';

export interface LocalSpeechDisplayRestorerConfig {
  baseUrl?: string;
}

/**
 * The local sidecar's `POST /restore`: a punctuation and case tagger.
 *
 * Text in, the same words out with marks and case. The sidecar refuses a
 * language it does not serve (400) and answers 503 until its model is seeded;
 * both surface as errors here, and the caller falls back to the plain display.
 */
export class LocalSpeechDisplayRestorer implements DisplayRestorer {
  readonly name = 'local';
  private readonly baseUrl: string;

  constructor(config: LocalSpeechDisplayRestorerConfig) {
    if (!config.baseUrl) {
      throw new ProviderConfigError('Local display restorer requires a baseUrl');
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  async restore(text: string, options: DisplayRestoreOptions): Promise<string> {
    const res = await fetchWithDeadline(
      `${this.baseUrl}/restore`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          language: options.language,
          context: options.context ?? '',
          terms: options.terms ?? [],
          ...(options.pauses === undefined ? {} : { pauses: options.pauses }),
        }),
      },
      LOCAL_RESTORE_TIMEOUT_MS,
      'Local display restore request',
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ProviderResponseError(
        `Local display restore returned ${res.status}: ${truncate(detail)}`,
        res.status,
      );
    }

    const json = (await res.json().catch(() => null)) as { text?: unknown } | null;
    if (typeof json?.text !== 'string') {
      throw new ProviderResponseError('Local display restore returned no text');
    }
    return json.text;
  }
}
