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
