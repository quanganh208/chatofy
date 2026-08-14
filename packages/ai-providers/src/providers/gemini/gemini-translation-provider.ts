// Gemini text translation provider — uses the official @google/genai SDK.
//
// The free tier meters requests per PROJECT per MODEL, both per minute and per
// day. Two axes follow from that, and this provider walks both.
//
// Models: a model that is out of quota says nothing about the next one, so the
// provider takes an ordered list and walks down it on a quota rejection. The
// per-minute ceiling is the one a live conversation hits, so a throttled entry
// is remembered and skipped until its own `retryDelay` elapses.
//
// Keys: an API key is not part of the quota identity — the project is (the
// rejection body says so itself: `GenerateRequestsPerMinutePerProjectPerModel`).
// Keys issued from DIFFERENT projects therefore draw on separate buckets, and
// rotating across them multiplies the ceiling. Keys from one project share a
// single bucket and rotation buys nothing; that condition is the operator's to
// satisfy and is documented where the keys are configured.
//
// The walk is model-major — every key is tried on the fast model before any
// key drops to the slow one. The measured p50s below are why: another
// project's flash model beats the same project's Gemma by an order of
// magnitude, so the reserve must not be reached while any flash quota is left.
//
// What this file keeps is the WALK. Which pairs are worth trying lives in
// `key-rotation.ts`, what a failure condemns lives in `error-classification.ts`,
// and what the model is actually asked lives in `prompt-builder.ts` — that last
// one is the prompt-injection boundary and has a live benchmark of its own.
//
// No thinking configuration is sent. Measured against the live API: the 3.x
// models reject `thinkingBudget` outright ("Request contains an invalid
// argument") and Gemma rejects both `thinkingBudget` and `thinkingLevel`
// ("Thinking … is not supported for this model"). Leaving the field off is both
// the only shape all of them accept and the fastest one measured.
import { GoogleGenAI } from '@google/genai';
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
import {
  isAuthFailure,
  isModelDenied,
  isOverloaded,
  quotaCooldownMs,
  MAX_DAILY_COOLDOWN_MS,
  OVERLOAD_COOLDOWN_MS,
} from './error-classification.js';
import { KeyRotation, resolveApiKeys } from './key-rotation.js';
import {
  buildContinuationReminder,
  buildReminder,
  buildTranslationInstruction,
  stripTranscriptTags,
  wrapTranscript,
} from './prompt-builder.js';

// Order leads with the newest flash model and keeps the slow one last. Measured
// p50 per short conversational sentence, streamed: 3.5-flash-lite 553ms,
// 3.1-flash-lite 557ms, gemma-4-31b-it 6884ms. The two flash models are a tie
// on the streamed path, so leading with the newer one costs no latency — on the
// blocking path 3.5 was 208ms slower, which is the reason this provider streams.
// Quota is metered per model, so the order buys the others nothing either way.
// Gemma is an order of magnitude slower and only earns its place as the last
// reserve — it carries 14,400 requests/day against the flash tier's 500.
const DEFAULT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-31b-it'];

export interface GeminiTranslationConfig {
  /**
   * One key, or several separated by commas, to rotate across.
   *
   * Ideally one key per Google Cloud project: quota is metered per project, so
   * keys from the same project share a single bucket and add no headroom.
   * Blank entries and exact duplicates are dropped.
   */
  apiKey?: string;
  /**
   * Models to try in order, each one used only after every key has spent its
   * quota on the previous. A single-entry list disables the fallback.
   */
  models?: string[];
}

export class GeminiTranslationProvider implements TranslationProvider {
  readonly name = 'gemini';
  private readonly keys: KeyRotation;
  private readonly models: string[];

  constructor(config: GeminiTranslationConfig) {
    const apiKeys = resolveApiKeys(config.apiKey);
    if (!apiKeys.length) {
      throw new ProviderConfigError('Gemini translation requires an apiKey');
    }
    this.keys = new KeyRotation(apiKeys);
    this.models = config.models?.length ? config.models : DEFAULT_MODELS;
  }

  async translate(req: TranslationRequest): Promise<TranslationResult> {
    const instruction = buildTranslationInstruction(req.sourceLanguage, req.targetLanguage);
    // `context` carries the translation already spoken aloud for this turn. When
    // it is present the request is a continuation, not a fresh translation: the
    // earlier clauses have been synthesized and heard, so this one must append.
    // Empty entries are dropped rather than joined into blank lines the model
    // has to interpret.
    const spokenSoFar = (req.context ?? [])
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ');
    const reminder = spokenSoFar
      ? buildContinuationReminder(req.targetLanguage, spokenSoFar)
      : buildReminder(req.targetLanguage);
    // The cooldown state stays shared even when the ladder is not: it records
    // what the API has actually said about each (project, model) bucket, which
    // holds no matter which caller's ladder led to the request.
    const ladder = req.models?.length ? req.models : this.models;
    const keys = this.keys.order();
    let lastError: unknown;
    let attempted = false;
    // A failure that is none of spent quota, a bad key, or an overloaded model
    // has no smaller blast radius left to escape to — it would repeat
    // identically on every remaining pair, so it ends the whole walk.
    let fatal = false;

    // Model-major: every key is tried on this model before any key moves to
    // the next one, because the reserve costs seconds where flash costs
    // milliseconds — see the measured p50s on DEFAULT_MODELS.
    for (const model of ladder) {
      if (fatal) break;

      for (const { index, client } of keys) {
        // Retired mid-walk by an earlier model in this same call.
        if (this.keys.isRetired(index)) continue;
        // A pair still inside its own cooldown would only 429 again, and that
        // wasted round-trip is paid on the latency-critical path.
        if (this.keys.isCoolingDown(index, model)) continue;

        attempted = true;
        try {
          return await this.generate(client, model, instruction, reminder, req.text);
        } catch (err) {
          lastError = err;
          if (this.recordFailure(err, index, model)) continue;
          if (isOverloaded(err)) {
            // Server capacity — the whole model row, briefly. Every key would
            // meet the same wall, so cool them together rather than paying to
            // discover it one wasted round-trip at a time, and take the next
            // model, which is the thing most likely to answer.
            this.keys.coolAll(model, OVERLOAD_COOLDOWN_MS);
            break;
          }
          fatal = true;
          break;
        }
      }
    }

    throw this.failure(lastError, attempted, ladder, keys);
  }

  /**
   * Remember what this failure condemns, and say whether the walk may continue
   * to the next key.
   *
   * Each branch is chosen by the failure's BLAST RADIUS: how much of the matrix
   * it actually rules out. Getting that wrong is what makes a pool behave worse
   * than a single key. Returns false for anything wider than one key, which the
   * caller handles — those need to break out of the key loop, not step through it.
   */
  private recordFailure(err: unknown, index: number, model: string): boolean {
    const cooldown = quotaCooldownMs(err);
    if (cooldown !== null) {
      // Spent quota — this pair only. Another project is untouched.
      this.keys.cool(index, model, cooldown);
      return true;
    }
    if (isAuthFailure(err)) {
      // The credential — every model under this key, permanently.
      this.keys.retire(index);
      return true;
    }
    if (isModelDenied(err)) {
      // Entitlement — this pair only. Another project may well have the model,
      // and this project's other models are unaffected.
      this.keys.cool(index, model, MAX_DAILY_COOLDOWN_MS);
      return true;
    }
    return false;
  }

  /** The error to throw once the walk has run out of pairs to try. */
  private failure(
    lastError: unknown,
    attempted: boolean,
    ladder: readonly string[],
    keys: readonly { index: number }[],
  ): Error {
    // Nothing the pool can serve is a configuration fault, not weather: no
    // later turn recovers from it, and the operator has to act.
    if (this.keys.allRetired) {
      // The rejection travels as the cause: "misconfigured" alone does not
      // tell an operator whether the key is malformed, its project has the API
      // disabled, or a referrer restriction is blocking it.
      return new ProviderConfigError(
        `every configured Gemini API key was rejected (${this.keys.size} key(s))`,
        lastError,
      );
    }

    // Every live pair was still cooling down, so nothing was even tried. Say
    // when the pool recovers instead of reporting a request that never
    // happened. Key indices, never key material, reach this message.
    if (!attempted) {
      const seconds = this.keys.soonestRecoverySeconds(ladder, keys);
      return new ProviderConnectionError(
        `every Gemini key × model is cooling down; the soonest recovers in ${seconds}s`,
      );
    }

    return lastError instanceof ProviderError
      ? lastError
      : new ProviderConnectionError('Gemini translation request failed', lastError);
  }

  /**
   * One streamed round-trip; SDK failures propagate unwrapped.
   *
   * Streaming is used for latency, not for incremental delivery: a one-sentence
   * turn comes back in a single chunk (measured chunks p50 = 1), so there is
   * nothing to forward early. What it buys is the round-trip itself — measured
   * p50 553ms streamed against 820ms blocking on `gemini-3.5-flash-lite`.
   */
  private async generate(
    client: GoogleGenAI,
    model: string,
    systemInstruction: string,
    reminder: string,
    text: string,
  ): Promise<TranslationResult> {
    const stream = await client.models.generateContentStream({
      model,
      // The transcript and the reminder are two parts of ONE user turn: the
      // reminder has to come after the data to be the last thing read, and a
      // separate turn would invite the model to answer the turn before it.
      contents: [
        {
          role: 'user',
          parts: [{ text: wrapTranscript(text) }, { text: reminder }],
        },
      ],
      config: { systemInstruction },
    });

    let translated = '';
    let reason: string | undefined;
    for await (const chunk of stream) {
      translated += chunk.text ?? '';
      // Only the chunk that stops generation carries the reason, and it is the
      // one thing that explains an empty body.
      reason ??= chunk.candidates?.[0]?.finishReason;
    }

    // Stripped BEFORE the emptiness test on purpose: a reply that is nothing
    // but the wrapper has said nothing, and must fail here rather than reach
    // speech synthesis as a blank turn.
    translated = stripTranscriptTags(translated).trim();
    if (!translated) {
      // The request succeeded but the body is unusable — a response-shape
      // failure, not a transport failure.
      throw new ProviderResponseError(
        `${model} returned no translation${reason ? ` (finishReason=${reason})` : ''}`,
      );
    }
    return { text: translated, model };
  }
}
