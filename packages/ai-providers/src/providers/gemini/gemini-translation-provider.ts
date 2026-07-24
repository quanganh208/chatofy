// Gemini text translation provider — uses the official @google/genai SDK.
//
// The free tier meters daily requests per project PER MODEL, so a model that
// has spent its quota says nothing about the next one. This provider therefore
// takes an ordered list of models and walks down it on a quota rejection; every
// entry is served by the same endpoint and the same API key.
//
// No thinking configuration is sent. Measured against the live API: the 3.x
// models reject `thinkingBudget` outright ("Request contains an invalid
// argument") and Gemma rejects both `thinkingBudget` and `thinkingLevel`
// ("Thinking … is not supported for this model"). Leaving the field off is both
// the only shape all of them accept and the fastest one measured.
import { GoogleGenAI } from '@google/genai';
import type { LanguageCode } from '../../interfaces/provider-types.js';
import type {
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from '../../interfaces/translation-provider.js';
import {
  ProviderConfigError,
  ProviderConnectionError,
  ProviderError,
  ProviderResponseError,
} from '../../errors/provider-errors.js';

const DEFAULT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-31b-it'];

const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  vi: 'Vietnamese',
  en: 'English',
};

export interface GeminiTranslationConfig {
  apiKey?: string;
  /**
   * Models to try in order, each one used only after the previous has spent its
   * daily quota. A single-entry list disables the fallback.
   */
  models?: string[];
}

/**
 * True when the SDK error is a quota rejection rather than a transport or
 * request fault. The SDK surfaces these as an error whose message carries the
 * raw JSON body, e.g. `{"error":{"code":429,…,"status":"RESOURCE_EXHAUSTED",
 * "quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}}`, so both the
 * structured fields and the message text are inspected.
 */
function isQuotaExhaustedError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const candidate = err as { status?: unknown; code?: unknown; message?: unknown };
  if (candidate.status === 429 || candidate.code === 429) return true;
  if (candidate.status === 'RESOURCE_EXHAUSTED') return true;
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  return /RESOURCE_EXHAUSTED|"code"\s*:\s*429/.test(message);
}

/** The translator instruction, identical for every model. */
function buildTranslationInstruction(
  sourceLanguage: LanguageCode,
  targetLanguage: LanguageCode,
): string {
  const source = LANGUAGE_NAMES[sourceLanguage] ?? sourceLanguage;
  const target = LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;
  return (
    `You are a professional translator. Translate the user's ${source} text into ${target}. ` +
    'Return ONLY the translated text — no preamble, quotes, or explanation. ' +
    // Downstream text-to-speech reads the output aloud, so spell identifiers out
    // digit by digit; leave real quantities as numerals so they read naturally.
    'When a number is an identifier that people read digit by digit (order, ' +
    'reference, booking, account, or invoice numbers; phone numbers; flight, ' +
    'seat, gate, or code identifiers; PINs or verification codes), write each ' +
    `digit as a separate spelled-out word in ${target} (for example the digits ` +
    '4 5 1 7 become four separate number-words, not "four thousand five hundred ' +
    'seventeen"). Keep ordinary quantities, prices, money amounts, measurements, ' +
    'years, dates, times, and percentages as normal numerals.'
  );
}

export class GeminiTranslationProvider implements TranslationProvider {
  readonly name = 'gemini';
  private readonly client: GoogleGenAI;
  private readonly models: string[];

  constructor(config: GeminiTranslationConfig) {
    if (!config.apiKey) {
      throw new ProviderConfigError('Gemini translation requires an apiKey');
    }
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
    this.models = config.models?.length ? config.models : DEFAULT_MODELS;
  }

  async translate(req: TranslationRequest): Promise<TranslationResult> {
    const instruction = buildTranslationInstruction(req.sourceLanguage, req.targetLanguage);
    let lastError: unknown;

    for (const model of this.models) {
      try {
        return await this.generate(model, instruction, req.text);
      } catch (err) {
        lastError = err;
        // A quota rejection is the one failure the next model can survive;
        // every other failure would repeat identically, so it stops the walk.
        if (!isQuotaExhaustedError(err)) break;
      }
    }

    throw lastError instanceof ProviderError
      ? lastError
      : new ProviderConnectionError('Gemini translation request failed', lastError);
  }

  /** One generateContent round-trip; SDK failures propagate unwrapped. */
  private async generate(
    model: string,
    systemInstruction: string,
    text: string,
  ): Promise<TranslationResult> {
    const response = await this.client.models.generateContent({
      model,
      contents: text,
      config: { systemInstruction },
    });

    const translated = response.text?.trim();
    if (!translated) {
      const reason = response.candidates?.[0]?.finishReason;
      // The request succeeded but the body is unusable — a response-shape
      // failure, not a transport failure.
      throw new ProviderResponseError(
        `${model} returned no translation${reason ? ` (finishReason=${reason})` : ''}`,
      );
    }
    return { text: translated, model };
  }
}
