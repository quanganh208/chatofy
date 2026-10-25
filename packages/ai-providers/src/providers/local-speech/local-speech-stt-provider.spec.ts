import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalSpeechSttProvider } from './local-speech-stt-provider.js';

/** The sidecar's pauses are passed on only when they are one sane number per word. */

const REAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  vi.restoreAllMocks();
});

const answering = (body: unknown) => {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
};

const transcribe = () =>
  new LocalSpeechSttProvider({ baseUrl: 'http://localhost:8012' }).transcribe(
    new Uint8Array([1, 2, 3]),
    'audio/wav',
    'vi',
  );

describe('LocalSpeechSttProvider pauses', () => {
  it('passes on one pause per word', async () => {
    answering({ text: 'Xin chào anh tuấn anh', language: 'vi', pauses: [0, 0, 0, 0, 420] });
    await expect(transcribe()).resolves.toMatchObject({ pauses: [0, 0, 0, 0, 420] });
  });

  it('drops pauses that do not line up with the words', async () => {
    answering({ text: 'Xin chào anh', language: 'vi', pauses: [0, 0] });
    expect(await transcribe()).not.toHaveProperty('pauses');
  });

  it('drops pauses for unspaced Han text rather than misaligning them', async () => {
    // Words are counted by whitespace here, so a Chinese clause is one word. A
    // pause list of any other length is dropped whole, never shifted.
    answering({ text: '我们明天去北京', language: 'zh', pauses: [0, 0, 120] });
    expect(await transcribe()).not.toHaveProperty('pauses');
  });

  it('drops pauses that are not non-negative numbers', async () => {
    answering({ text: 'Xin chào', language: 'vi', pauses: [0, 'x'] });
    expect(await transcribe()).not.toHaveProperty('pauses');
    answering({ text: 'Xin chào', language: 'vi', pauses: [0, -5] });
    expect(await transcribe()).not.toHaveProperty('pauses');
  });

  it('passes on the silence before the first word with the pauses', async () => {
    answering({ text: 'Xin chào', language: 'vi', pauses: [0, 90], leadPause: 280 });
    await expect(transcribe()).resolves.toMatchObject({ pauses: [0, 90], leadPause: 280 });
  });

  it('drops the silence before the first word without pauses, or when it is not sane', async () => {
    answering({ text: 'Xin chào', language: 'vi', pauses: [0], leadPause: 280 });
    expect(await transcribe()).not.toHaveProperty('leadPause');
    answering({ text: 'Xin chào', language: 'vi', pauses: [0, 90], leadPause: -1 });
    expect(await transcribe()).not.toHaveProperty('leadPause');
  });

  it('has none from a sidecar that does not send them', async () => {
    answering({ text: 'Xin chào', language: 'vi' });
    expect(await transcribe()).not.toHaveProperty('pauses');
  });
});

describe('LocalSpeechSttProvider alternates', () => {
  const sentForm = () =>
    (vi.mocked(globalThis.fetch).mock.calls[0]![1] as RequestInit).body as FormData;

  it('asks for them only when the caller does', async () => {
    answering({ text: 'Xin chào', language: 'vi' });
    await transcribe();
    expect(sentForm().has('alternates')).toBe(false);

    answering({ text: 'Xin chào', language: 'vi' });
    await new LocalSpeechSttProvider({ baseUrl: 'http://localhost:8012' }).transcribe(
      new Uint8Array([1, 2, 3]),
      'audio/wav',
      'vi',
      { alternates: true },
    );
    expect(sentForm().get('alternates')).toBe('true');
  });

  it('passes on the non-blank strings the sidecar sent', async () => {
    answering({ text: 'Đâm giao', language: 'vi', alternates: ['Đâm dao', '', 3] });
    await expect(transcribe()).resolves.toMatchObject({ alternates: ['Đâm dao'] });
  });

  it('has none when the sidecar sent none, or nothing usable', async () => {
    answering({ text: 'Xin chào', language: 'vi' });
    expect(await transcribe()).not.toHaveProperty('alternates');
    answering({ text: 'Xin chào', language: 'vi', alternates: 'Xin chào' });
    expect(await transcribe()).not.toHaveProperty('alternates');
  });
});

describe('LocalSpeechSttProvider candidates', () => {
  const formOf = (call: number) =>
    (vi.mocked(globalThis.fetch).mock.calls[call]![1] as RequestInit).body as FormData;

  const identify = (
    candidates: ('vi' | 'en' | 'zh')[] | undefined,
    onIdentifyUnavailable?: () => void,
  ) =>
    new LocalSpeechSttProvider({ baseUrl: 'http://localhost:8012' }).transcribe(
      new Uint8Array([1, 2, 3]),
      'audio/wav',
      'vi',
      { candidates, onIdentifyUnavailable },
    );

  it('sends one field per candidate, and none for a single candidate', async () => {
    answering({ text: 'hello', language: 'en', languageConfidence: 0.93 });
    await identify(['vi', 'en']);
    expect(formOf(0).getAll('candidates')).toEqual(['vi', 'en']);
    expect(formOf(0).get('language')).toBe('vi');

    answering({ text: 'xin chào', language: 'vi' });
    const single = await identify(['vi']);
    expect(formOf(0).has('candidates')).toBe(false);
    expect(single).not.toHaveProperty('identified');
  });

  it('takes the language the sidecar identified among the candidates, with its confidence', async () => {
    answering({ text: 'hello', language: 'en', languageConfidence: 0.93, lidSpeechMs: 1800 });
    await expect(identify(['vi', 'en'])).resolves.toMatchObject({
      text: 'hello',
      language: 'en',
      identified: true,
      languageConfidence: 0.93,
      lidSpeechMs: 1800,
    });
  });

  it('keeps an explicit null confidence as "decided, not sure"', async () => {
    answering({ text: 'hello', language: 'en', languageConfidence: null });
    const result = await identify(['vi', 'en']);
    expect(result).toMatchObject({ language: 'en', identified: true, languageConfidence: null });
    expect(result).not.toHaveProperty('lidSpeechMs');
  });

  it('reads a language outside the candidates as a declared decode', async () => {
    answering({ text: '你好', language: 'zh', languageConfidence: 0.8, lidSpeechMs: 900 });
    const result = await identify(['vi', 'en']);
    expect(result).toMatchObject({ language: 'vi', identified: false });
    expect(result).not.toHaveProperty('languageConfidence');
    expect(result).not.toHaveProperty('lidSpeechMs');
  });

  it('reads an older sidecar that echoed the request with no confidence as a declared decode', async () => {
    answering({ text: 'xin chào', language: 'vi' });
    await expect(identify(['vi', 'en'])).resolves.toMatchObject({
      language: 'vi',
      identified: false,
    });
  });

  it('decodes once more without candidates when identification is switched off, and says so', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () => 'language identification not enabled',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ text: 'xin chào', language: 'vi' }),
      });
    const unavailable = vi.fn();

    const result = await identify(['vi', 'en'], unavailable);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(formOf(0).getAll('candidates')).toEqual(['vi', 'en']);
    expect(formOf(1).has('candidates')).toBe(false);
    expect(unavailable).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ text: 'xin chào', language: 'vi', identified: false });
  });

  it('does not retry a 409 on a request that sent no candidates', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => 'conflict',
    });
    await expect(identify(undefined)).rejects.toThrow('Local STT returned 409');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('LocalSpeechSttProvider identifiable languages', () => {
  const served = () =>
    new LocalSpeechSttProvider({ baseUrl: 'http://localhost:8012' }).supportedLanguages();

  it('reports the languages /healthz says the identifier can choose between', async () => {
    answering({ languages: ['vi', 'en', 'zh'], lidLanguages: ['vi', 'en'] });
    await expect(served()).resolves.toEqual({
      known: ['vi', 'en', 'zh'],
      unknown: [],
      identifiable: ['vi', 'en'],
    });
  });

  it('reports none while identification is switched off', async () => {
    answering({ languages: ['vi', 'en'], lidLanguages: [] });
    await expect(served()).resolves.toMatchObject({ identifiable: [] });
  });

  it('leaves identifiable absent for a sidecar that predates it', async () => {
    answering({ languages: ['vi', 'en'] });
    expect(await served()).not.toHaveProperty('identifiable');
  });

  it('keeps only registry languages the sidecar also recognises', async () => {
    answering({ languages: ['vi'], lidLanguages: ['vi', 'en', 'xx', 'vi'] });
    await expect(served()).resolves.toMatchObject({ identifiable: ['vi'] });
  });
});
