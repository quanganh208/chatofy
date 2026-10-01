import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderResponseError } from '../../errors/provider-errors.js';
import { LocalSpeechDisplayRestorer } from './local-speech-display-restorer.js';

/** What goes to `POST /restore`, and what comes back is believed only as text. */

const REAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  vi.restoreAllMocks();
});

const answering = (body: unknown, init: { ok?: boolean; status?: number } = {}) => {
  const fetch = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => 'not loaded',
  });
  globalThis.fetch = fetch;
  return fetch;
};

const restorer = () => new LocalSpeechDisplayRestorer({ baseUrl: 'http://localhost:8012/' });

describe('LocalSpeechDisplayRestorer', () => {
  it('sends the text, language, context and terms, and returns the restored text', async () => {
    const fetch = answering({ text: 'Mô hình AI của OpenAI.' });

    await expect(
      restorer().restore('mô hình ai của openai', {
        language: 'vi',
        context: 'trong một bài kiểm tra',
        terms: ['VNeID'],
      }),
    ).resolves.toBe('Mô hình AI của OpenAI.');

    const [url, request] = fetch.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('http://localhost:8012/restore');
    expect(JSON.parse(request.body)).toEqual({
      text: 'mô hình ai của openai',
      language: 'vi',
      context: 'trong một bài kiểm tra',
      terms: ['VNeID'],
    });
  });

  it('sends the pauses only when the caller has them', async () => {
    const fetch = answering({ text: 'Xin chào anh Tuấn Anh.' });

    await restorer().restore('xin chào anh tuấn anh', {
      language: 'vi',
      pauses: [0, 0, 0, 0, 400],
    });
    await restorer().restore('xin chào', { language: 'vi' });

    const bodies = fetch.mock.calls.map(([, r]) => JSON.parse((r as { body: string }).body));
    expect(bodies[0].pauses).toEqual([0, 0, 0, 0, 400]);
    expect(bodies[1]).not.toHaveProperty('pauses');
  });

  it('sends empty context and terms when the caller has none', async () => {
    const fetch = answering({ text: 'Xin chào.' });

    await restorer().restore('xin chào', { language: 'vi' });

    const [, request] = fetch.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(request.body)).toMatchObject({ context: '', terms: [] });
  });

  it('fails on a sidecar that has not loaded the model, for the caller to fall back', async () => {
    answering(null, { ok: false, status: 503 });

    await expect(restorer().restore('xin chào', { language: 'vi' })).rejects.toBeInstanceOf(
      ProviderResponseError,
    );
  });

  it('fails on a body with no text rather than displaying nothing', async () => {
    answering({ text: 42 });

    await expect(restorer().restore('xin chào', { language: 'vi' })).rejects.toBeInstanceOf(
      ProviderResponseError,
    );
  });
});
