// Gemini text translation provider — uses the official @google/genai SDK.
// Thinking is disabled by default (budget 0) since it adds latency without
// quality benefit for translation; the quality tier raises the model instead.
import { GoogleGenAI } from '@google/genai';
import type { LanguageCode } from '../../interfaces/provider-types.js';
import type {
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from '../../interfaces/translation-provider.js';
import { ProviderConfigError, ProviderConnectionError } from '../../errors/provider-errors.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';

const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  vi: 'Vietnamese',
  en: 'English',
};

export interface GeminiTranslationConfig {
  apiKey?: string;
  /** Gemini model id, e.g. `gemini-2.5-flash`. */
  model?: string;
  /** Thinking budget: 0 = off (default), -1 = dynamic. */
  thinkingBudget?: number;
}

export class GeminiTranslationProvider implements TranslationProvider {
  readonly name = 'gemini';
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly thinkingBudget: number;

  constructor(config: GeminiTranslationConfig) {
    if (!config.apiKey) {
      throw new ProviderConfigError('Gemini translation requires an apiKey');
    }
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
    this.model = config.model ?? DEFAULT_MODEL;
    this.thinkingBudget = config.thinkingBudget ?? 0;
  }

  async translate(req: TranslationRequest): Promise<TranslationResult> {
    const source = LANGUAGE_NAMES[req.sourceLanguage] ?? req.sourceLanguage;
    const target = LANGUAGE_NAMES[req.targetLanguage] ?? req.targetLanguage;
    const systemInstruction =
      `You are a professional translator. Translate the user's ${source} text into ${target}. ` +
      'Return ONLY the translated text — no preamble, quotes, or explanation.';

    let response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;
    try {
      response = await this.client.models.generateContent({
        model: this.model,
        contents: req.text,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingBudget: this.thinkingBudget },
        },
      });
    } catch (err) {
      throw new ProviderConnectionError('Gemini translation request failed', err);
    }

    const text = response.text?.trim();
    if (!text) {
      const reason = response.candidates?.[0]?.finishReason;
      throw new ProviderConnectionError(
        `Gemini returned no translation${reason ? ` (finishReason=${reason})` : ''}`,
      );
    }
    return { text };
  }
}
