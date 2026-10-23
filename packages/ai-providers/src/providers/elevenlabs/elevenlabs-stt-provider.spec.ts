import { afterEach, describe, expect, it, vi } from 'vitest';

import { ElevenLabsSttProvider } from './elevenlabs-stt-provider.js';

const REAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  vi.restoreAllMocks();
});

const answering = (body: unknown) => {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
};

const provider = () => new ElevenLabsSttProvider({ apiKey: 'test-key' });

const sentForm = () =>
  (vi.mocked(globalThis.fetch).mock.calls[0]![1] as RequestInit).body as FormData;

describe('ElevenLabsSttProvider language identification', () => {
  it('reports no identifiable languages', () => {
    expect('supportedLanguages' in provider()).toBe(false);
  });

  it('asks Scribe for the declared language and never forwards candidates', async () => {
    answering({ text: 'hello', language_code: 'vie' });
    await provider().transcribe(new Uint8Array([1, 2, 3]), 'audio/wav', 'vi', {
      candidates: ['vi', 'en'],
    });
    expect(sentForm().get('language_code')).toBe('vi');
    expect(sentForm().has('candidates')).toBe(false);
  });

  it('answers the declared language, marked as not identified, when asked to choose', async () => {
    answering({ text: 'hello', language_code: 'eng' });
    await expect(
      provider().transcribe(new Uint8Array([1]), 'audio/wav', 'vi', { candidates: ['vi', 'en'] }),
    ).resolves.toEqual({ text: 'hello', language: 'vi', identified: false });
  });

  it('answers exactly as before when no choice was asked for', async () => {
    answering({ text: 'xin chào', language_code: 'vie' });
    await expect(provider().transcribe(new Uint8Array([1]), 'audio/wav', 'vi')).resolves.toEqual({
      text: 'xin chào',
      language: 'vi',
    });
  });

  it('still refuses an unexpected response', async () => {
    answering({ nope: true });
    await expect(provider().transcribe(new Uint8Array([1]), 'audio/wav', 'en')).rejects.toThrow(
      'unexpected response',
    );
  });
});
