import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderConfigError, ProviderResponseError } from '../../errors/provider-errors.js';
import {
  OpenAiCompatibleLoanwordRespeller,
  parseProposals,
} from './openai-compatible-loanword-respeller.js';
import { LOANWORD_RESPELLING_INSTRUCTION } from './loanword-respelling-prompt.js';

/**
 * The wire shape and what the provider believes coming back. How a model
 * answers the prompt is `benchmarks/prompt-injection`'s and
 * `benchmarks/loanword-respelling`'s question, not a unit test's.
 */

const REAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  vi.restoreAllMocks();
});

const REQUEST = {
  transcript: 'lợi dụng deep fred để lừa đảo',
  translation: 'exploiting deepfakes for fraud',
  spans: ['deep fred'],
};

function answering(content: unknown, init: { ok?: boolean; status?: number } = {}) {
  const calls: Record<string, unknown>[] = [];
  globalThis.fetch = vi.fn(async (_url: unknown, request: unknown) => {
    calls.push(JSON.parse((request as { body: string }).body) as Record<string, unknown>);
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => 'refused',
    } as Response;
  }) as typeof fetch;
  return calls;
}

const respeller = () =>
  new OpenAiCompatibleLoanwordRespeller({
    apiKey: 'test-key',
    baseUrl: 'https://host.example/',
    model: 'flash',
    extraBody: { thinking: { type: 'disabled' } },
  });

describe('OpenAiCompatibleLoanwordRespeller', () => {
  it('sends one JSON-mode request carrying the host row fields and the data as JSON', async () => {
    const calls = answering('{"deep fred": "deepfake"}');
    await expect(respeller().respell(REQUEST)).resolves.toEqual({ 'deep fred': 'deepfake' });

    expect(calls).toHaveLength(1);
    const body = calls[0]!;
    expect(body.model).toBe('flash');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.stream).toBeUndefined();
    const [system, user] = body.messages as { role: string; content: string }[];
    expect(system).toEqual({ role: 'system', content: LOANWORD_RESPELLING_INSTRUCTION });
    expect(JSON.parse(user!.content)).toEqual(REQUEST);
  });

  it('asks nothing when there is no span', async () => {
    const calls = answering('{}');
    await expect(respeller().respell({ ...REQUEST, spans: [] })).resolves.toEqual({});
    expect(calls).toHaveLength(0);
  });

  it('throws a response error on a non-2xx answer', async () => {
    answering('', { ok: false, status: 429 });
    await expect(respeller().respell(REQUEST)).rejects.toBeInstanceOf(ProviderResponseError);
  });

  it('refuses to construct without a key', () => {
    expect(() => new OpenAiCompatibleLoanwordRespeller({ baseUrl: 'x', model: 'y' })).toThrow(
      ProviderConfigError,
    );
  });
});

describe('parseProposals', () => {
  it('keeps only the spans asked, as strings or null', () => {
    expect(
      parseProposals('{"deep fred": "deepfake", "ok": null, "other": "x", "n": 3}', [
        'deep fred',
        'ok',
        'n',
      ]),
    ).toEqual({ 'deep fred': 'deepfake', ok: null });
  });

  it.each(['not json', '[]', 'null', ''])('reads %j as no proposals', (content) => {
    expect(parseProposals(content, ['deep fred'])).toEqual({});
  });
});
