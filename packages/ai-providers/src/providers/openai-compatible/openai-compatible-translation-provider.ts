// Translation over the OpenAI chat-completions wire format, against any host
// that speaks it.
//
// One class rather than one per vendor, because the vendors differ in three
// fields and nothing else: the base URL, the model id, and a handful of
// top-level body flags. DeepSeek, Alibaba's international Model Studio, Z.ai,
// Groq, Cerebras and OpenAI itself all accept the same request shape, so a
// provider per vendor would be the same file copied with a different string in
// it — and the copy that drifted would be the one nobody was reading.
//
// What it is FOR is measurement. Benchmarking a candidate model against
// `gemini-3.5-flash-lite` only says something about production if the candidate
// is asked the same question, so this file deliberately owns no prompt of its
// own: it imports the shipped one. `benchmarks/error-analysis` and
// `benchmarks/prompt-injection` both refuse a harness that carries its own copy
// of the instruction, for the reason their READMEs give, and this is the same
// rule applied one layer down.
//
// What it deliberately does NOT do, and why:
//
// - **No key rotation.** Gemini's exists because the free tier meters per
//   PROJECT, so extra keys multiply a ceiling. The hosts this provider talks to
//   meter per account and sell concurrency instead — DeepSeek publishes 2500 for
//   `deepseek-flash` — so a second key buys nothing and the rotation machinery
//   would be untested weight.
// - **No quota cooldown memory.** Same reason: the 429 this is built to survive
//   is an occasional burst, not the every-few-turns wall the free Gemini tier
//   puts up, so remembering a `retryDelay` per pair has nothing to remember.
//
// The model ladder IS kept, because `TranslationRequest.models` is part of the
// interface and callers already use it to give speculative and final traffic
// different orders.
import {
  ProviderConfigError,
  ProviderConnectionError,
  ProviderError,
  ProviderResponseError,
} from '../../errors/provider-errors.js';
import type {
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from '../../interfaces/translation-provider.js';
import { normalizeTranscript } from '../../text/vietnamese.js';
import { fetchStreamWithDeadlines } from '../fetch-stream-with-deadlines.js';
import { truncate } from '../http-util.js';
// The prompt and the stream forwarder live under `gemini/` for historical
// reasons and are not Gemini-specific: the instruction is the product's
// translation contract and the forwarder strips the product's wrapper tag.
// Imported rather than reimplemented — a second copy of the injection boundary
// is the one thing this file must never grow.
import {
  buildContextBlock,
  buildReminder,
  buildTranslationInstruction,
  needsPriorSpeech,
  stripTranscriptTags,
  wrapTranscript,
} from '../gemini/prompt-builder.js';
import { StreamForwarder } from '../gemini/stream-forwarder.js';

/**
 * How long one translation may take, in three bounds rather than one.
 *
 * Sized from measurement rather than taste: ten streamed turns against
 * `deepseek-flash` from Vietnam gave p50 852ms end to end and p50 761ms to the
 * first token, with the slowest at 951ms. These budgets sit an order of
 * magnitude above that, because a deadline that cuts a slow-but-working call
 * costs the caller a turn that was about to succeed. They bound the hang, not
 * the latency.
 */
const FIRST_TOKEN_TIMEOUT_MS = 20_000;
const IDLE_TIMEOUT_MS = 10_000;
const TOTAL_TIMEOUT_MS = 45_000;

/**
 * Ceiling on generated tokens.
 *
 * A turn is one utterance — `SpeechGate` cuts at 8 seconds — so a translation
 * that runs past a few hundred tokens is a model that has stopped translating
 * and started talking. Bounding it turns that from a long wait into a short
 * wrong answer, which is the failure the benchmark can see. Named here because
 * some hosts default it high: DeepSeek's non-thinking default is 8K.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 512;

export interface OpenAiCompatibleTranslationConfig {
  /** Bearer token for the host. One key; see the file header on rotation. */
  apiKey?: string;
  /**
   * Host root, with or without a trailing slash — `https://api.deepseek.com`.
   *
   * `/chat/completions` is appended. A base that already ends in `/v1` works
   * unchanged, which is what OpenAI, Groq and Model Studio need.
   */
  baseUrl?: string;
  /** Models to try in order. A single-entry list disables the fallback. */
  models?: string[];
  /**
   * What this provider calls itself in logs, results and the registry.
   *
   * Defaulted rather than required so a caller can construct one without
   * ceremony, but worth setting: `TranslationResult.model` names the model and
   * this names the host, and a recorded benchmark row needs both to be
   * reproducible.
   */
  name?: string;
  /**
   * Extra top-level fields merged into every request body.
   *
   * The escape hatch that lets one class serve hosts with incompatible flags,
   * and the reason it is untyped: these are vendor extensions, not OpenAI
   * fields, and typing them here would mean editing this file for every new
   * host — exactly the coupling the single class exists to avoid.
   *
   * The case that motivated it: DeepSeek enables thinking mode BY DEFAULT at
   * effort `high`, so a bare request returns a reasoning model's latency.
   * `{ thinking: { type: 'disabled' } }` turns it off. Note that DeepSeek then
   * pins `temperature` to 1.0 and ignores whatever is sent, so a caller cannot
   * make its output deterministic and a benchmark must measure the variance
   * instead of assuming it away.
   */
  extraBody?: Record<string, unknown>;
  /** Overrides {@link DEFAULT_MAX_OUTPUT_TOKENS}. */
  maxOutputTokens?: number;
  /**
   * Which field carries the output ceiling on this host.
   *
   * Its own option rather than another {@link extraBody} entry, because
   * `extraBody` can only ADD a field: it is spread first precisely so a vendor
   * flag cannot replace `model` or `stream`, and that same ordering means it
   * cannot replace or remove `max_tokens` either. The hosts that want the other
   * name do not merely prefer it — OpenAI's reasoning-capable models REJECT the
   * request outright with "Unsupported parameter: 'max_tokens' is not supported
   * with this model" — so sending both is not an option and the name has to be
   * chosen rather than added.
   */
  maxOutputTokensField?: 'max_tokens' | 'max_completion_tokens';
}

/** The slice of a chat-completions stream chunk this provider reads. */
interface StreamChunk {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
}

export class OpenAiCompatibleTranslationProvider implements TranslationProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly models: string[];
  private readonly extraBody: Record<string, unknown>;
  private readonly maxOutputTokens: number;
  private readonly maxOutputTokensField: 'max_tokens' | 'max_completion_tokens';

  constructor(config: OpenAiCompatibleTranslationConfig) {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) {
      throw new ProviderConfigError('OpenAI-compatible translation requires an apiKey');
    }
    const baseUrl = config.baseUrl?.trim().replace(/\/+$/, '');
    if (!baseUrl) {
      throw new ProviderConfigError('OpenAI-compatible translation requires a baseUrl');
    }
    if (!config.models?.length) {
      // No default ladder on purpose. Gemini can name one because it addresses
      // a single vendor; here the model id is meaningless without the base URL
      // it belongs to, and a guessed pair fails at the first request with a
      // message about the model rather than about the configuration.
      throw new ProviderConfigError('OpenAI-compatible translation requires at least one model');
    }

    this.apiKey = apiKey;
    this.endpoint = `${baseUrl}/chat/completions`;
    this.models = [...config.models];
    this.name = config.name ?? 'openai-compatible';
    this.extraBody = config.extraBody ?? {};
    this.maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    // Defaulted to the older name because that is what every host this has been
    // measured against accepts, OpenAI's own non-reasoning models included.
    this.maxOutputTokensField = config.maxOutputTokensField ?? 'max_tokens';
  }

  async translate(req: TranslationRequest): Promise<TranslationResult> {
    // Every step below mirrors `GeminiTranslationProvider.translate` and the
    // reasoning travels with it there: canonicalize once so all entry points
    // get it, build the prompt once rather than per attempt, and withhold
    // earlier speech from a turn long enough to stand alone.
    const text = normalizeTranscript(req.text);
    const context = buildContextBlock(
      req.hints,
      req.sourceLanguage,
      needsPriorSpeech(text) ? req.context : undefined,
    );
    const instruction = buildTranslationInstruction(
      req.sourceLanguage,
      req.targetLanguage,
      context !== null,
      context?.hasPriorSpeech ?? false,
    );

    // The three parts of the Gemini user turn, joined into the one string this
    // wire format allows. The ORDER is the part that matters and it is the same
    // order for the same reason: context must be in view before the transcript
    // to disambiguate it, and the reminder must be last because the last thing
    // in a turn is what a model weighs most.
    const user = [context?.text, wrapTranscript(text), buildReminder(req.targetLanguage)]
      .filter((part): part is string => Boolean(part))
      .join('\n\n');

    const ladder = this.ladderFor(req.models);
    let lastError: unknown;
    for (const model of ladder) {
      try {
        return await this.generate(model, instruction, user, req.onChunk);
      } catch (err) {
        lastError = err;
        // Only a busy or broken HOST says anything about the next model being
        // worth trying. A rejected key, a malformed request or an unusable body
        // would repeat identically down the whole ladder, so they end the walk
        // where they happen instead of costing a round-trip per entry.
        if (!isWorthAnotherModel(err)) throw err;
      }
    }

    throw lastError instanceof ProviderError
      ? lastError
      : new ProviderConnectionError(`${this.name} translation request failed`, lastError);
  }

  /**
   * Which models this request may actually spend, given what the caller asked
   * for and what this host serves.
   *
   * A caller's ladder is honoured only where the two overlap, and the reason is
   * a failure this provider was measured hitting rather than a precaution. The
   * live path pins its models in `translation-model-policy.ts` — Gemini ids,
   * chosen so that speculative traffic and end-of-turn traffic spend separate
   * per-minute buckets — and passes them down as `TranslationRequest.models`,
   * which the interface says overrides whatever the provider was configured
   * with. Honouring that literally sent `gemini-3.5-flash-lite` to DeepSeek,
   * which answered 400 on every turn of a benchmark run: "The supported API
   * model names are deepseek-flash, deepseek-v4-pro".
   *
   * Ignoring the field outright is what the interface already permits — it says
   * providers addressing one model do — but it would also discard a genuine
   * ladder from a caller naming two models this host really has. Intersecting
   * keeps both: a caller that knows this host still steers it, and a ladder
   * meant for another vendor falls back to what was configured instead of
   * failing the turn.
   */
  private ladderFor(requested: readonly string[] | undefined): string[] {
    if (!requested?.length) return this.models;
    const mine = requested.filter((model) => this.models.includes(model));
    return mine.length ? mine : this.models;
  }

  /**
   * One streamed round-trip.
   *
   * Streamed for the round-trip rather than for incremental delivery, which is
   * the same trade Gemini's provider documents: a one-sentence turn arrives in
   * very few chunks, so `onChunk` buys a caller little here, while reading the
   * first token as it lands rather than waiting for the whole body is worth
   * roughly a tenth of a second on every turn.
   */
  private async generate(
    model: string,
    systemInstruction: string,
    user: string,
    onChunk?: (delta: string, restart: boolean) => void,
  ): Promise<TranslationResult> {
    const body = {
      // Caller extensions first, so a vendor flag can never silently replace
      // the fields this provider depends on to work at all.
      ...this.extraBody,
      model,
      stream: true,
      [this.maxOutputTokensField]: this.maxOutputTokens,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: user },
      ],
    };

    const { response, chunks, discard } = await fetchStreamWithDeadlines(
      this.endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      {
        firstByteMs: FIRST_TOKEN_TIMEOUT_MS,
        idleMs: IDLE_TIMEOUT_MS,
        totalMs: TOTAL_TIMEOUT_MS,
        // This interface has no caller abort to honour. A never-aborted signal
        // keeps the helper's own timers as the only thing that can cut the
        // stream, and keeps its abort/timeout distinction meaningful.
        signal: new AbortController().signal,
      },
      `${this.name} ${model}`,
    );

    if (!response.ok) {
      discard();
      const detail = await response.text().catch(() => '');
      throw new ProviderResponseError(
        `${this.name} ${model} answered ${response.status}: ${truncate(detail)}`,
        response.status,
      );
    }

    let translated = '';
    let reason: string | undefined;
    // One forwarder per attempt, so a retry on the next model announces its own
    // restart rather than appending to what the abandoned attempt showed.
    const forwarder = onChunk ? new StreamForwarder(onChunk) : null;
    const decoder = new TextDecoder();
    let buffered = '';

    for await (const bytes of chunks) {
      buffered += decoder.decode(bytes, { stream: true });
      // Server-sent events are newline-delimited and a chunk may split one, so
      // the tail after the last newline is carried rather than parsed.
      let cut: number;
      while ((cut = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, cut).trim();
        buffered = buffered.slice(cut + 1);
        const event = parseEventLine(line);
        if (!event) continue;
        translated += event.choices?.[0]?.delta?.content ?? '';
        reason ??= event.choices?.[0]?.finish_reason ?? undefined;
        forwarder?.push(translated);
      }
    }

    // Stripped BEFORE the emptiness test, as Gemini's is: a reply that is
    // nothing but the wrapper tag has said nothing, and must fail here rather
    // than reach speech synthesis as a blank turn.
    translated = stripTranscriptTags(translated).trim();
    if (!translated) {
      throw new ProviderResponseError(
        `${this.name} ${model} returned an empty response${
          reason ? ` (finish_reason=${reason})` : ''
        }`,
      );
    }
    return { text: translated, model };
  }
}

/**
 * One SSE line, or nothing when the line carries no chunk.
 *
 * A malformed payload is SKIPPED rather than thrown on, and that is deliberate:
 * hosts interleave keep-alive comments and vendor-specific events into the same
 * stream, and failing the turn over one unparseable line would discard a
 * translation that arrived intact around it. A body that was entirely
 * unparseable still fails, through the emptiness check at the end.
 */
function parseEventLine(line: string): StreamChunk | null {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice('data:'.length).trim();
  if (!payload || payload === '[DONE]') return null;
  try {
    return JSON.parse(payload) as StreamChunk;
  } catch {
    return null;
  }
}

/**
 * Whether this failure leaves the next model worth a round-trip.
 *
 * Rate limits and server faults are properties of one model's capacity, so the
 * next entry may well answer. Everything else — a rejected key, a request the
 * host would not parse, a body that came back unusable — is a property of the
 * request or the credential and would reproduce identically all the way down.
 */
function isWorthAnotherModel(err: unknown): boolean {
  if (err instanceof ProviderConnectionError) return true;
  if (!(err instanceof ProviderResponseError)) return false;
  const status = err.status;
  return status === 429 || (status !== undefined && status >= 500);
}
