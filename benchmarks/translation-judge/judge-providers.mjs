// The two hosts a judge can run on, and what a call costs.
//
// A `claude-*` model goes to the Anthropic API through the official SDK; any
// other model to Gemini's REST API. Each asker returns the parsed answer, the
// time it took and the usage the host reported, and throws on anything that
// is not a valid answer, so the caller records it as a failed call.
import Anthropic from '@anthropic-ai/sdk';

import {
  JSON_SCHEMA,
  RESPONSE_SCHEMA,
  SYSTEM_INSTRUCTION,
  judgeMessage,
  parseAnswer,
} from './judge-prompt.mjs';

/** USD per million tokens (Anthropic first-party rates, cached 2026-10-06). */
export const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};

/** What one Claude call cost, from its reported usage; 0 for a model without a price here. */
export function costOf(model, usage) {
  const price = PRICES[model];
  if (!price || !usage) return 0;
  return (
    ((usage.input_tokens ?? 0) * price.input +
      (usage.output_tokens ?? 0) * price.output +
      (usage.cache_read_input_tokens ?? 0) * price.cacheRead +
      (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite) /
    1e6
  );
}

export function isClaude(model) {
  return model.startsWith('claude-');
}

/**
 * Claude, at the effort given (thinking is adaptive and cannot be turned off
 * on the current models). No server-side fallback: a declined turn must fail
 * here, not be answered by a different model inside a one-model run.
 */
export function claudeAsker(model, effort) {
  // SDK retries cover 429, 5xx and dropped connections.
  const client = new Anthropic({ maxRetries: 6 });
  return async (row) => {
    const started = Date.now();
    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      system: SYSTEM_INSTRUCTION,
      output_config: { effort, format: { type: 'json_schema', schema: JSON_SCHEMA } },
      messages: [{ role: 'user', content: judgeMessage(row) }],
    });
    if (response.stop_reason === 'refusal') {
      throw new Error(`refused (${response.stop_details?.category ?? 'no category'})`);
    }
    if (response.stop_reason === 'max_tokens') throw new Error('hit max_tokens');
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return {
      ...parseAnswer(text),
      ms: Date.now() - started,
      usage: response.usage,
      servedBy: response.model,
      costUsd: costOf(model, response.usage),
    };
  };
}

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Gemini; GEMINI_API_KEY may hold several comma-separated keys, rotated on 429/503. */
export function geminiAsker(model) {
  const keys = (process.env.GEMINI_API_KEY ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  if (!keys.length) throw new Error('GEMINI_API_KEY is not set');
  let index = 0;
  // A free key's limit is per minute, so after every key has been tried the
  // wait grows towards a minute rather than giving up within seconds.
  const wait = (attempt) =>
    new Promise((done) =>
      setTimeout(done, Math.min(60_000, 3000 * 2 ** Math.floor(attempt / keys.length))),
    );
  const body = (row) => ({
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: judgeMessage(row) }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
  });
  return async (row) => {
    for (let attempt = 0; attempt < 6 * keys.length; attempt += 1) {
      const started = Date.now();
      let response;
      try {
        response = await fetch(`${GEMINI_API}/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': keys[index % keys.length],
          },
          body: JSON.stringify(body(row)),
          signal: AbortSignal.timeout(120_000),
        });
      } catch {
        // A dropped connection or a timeout says nothing about the turn.
        await wait(attempt);
        continue;
      }
      if (response.status === 429 || response.status === 503) {
        index += 1;
        await wait(attempt);
        continue;
      }
      const json = await response.json();
      if (!response.ok)
        throw new Error(`HTTP ${response.status}: ${json.error?.message ?? 'no message'}`);
      const candidate = json.candidates?.[0];
      const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('');
      if (!text) throw new Error(`no answer (finishReason ${candidate?.finishReason ?? 'none'})`);
      return {
        ...parseAnswer(text),
        ms: Date.now() - started,
        usage: json.usageMetadata ?? null,
        costUsd: 0,
      };
    }
    throw new Error('rate-limited on every key');
  };
}
