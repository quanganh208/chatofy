import {
  LocalSpeechSttProvider,
  LocalSpeechTtsProvider,
} from '@chatofy/ai-providers';

/**
 * Real provider↔sidecar integration checks for the local speech stack. Skipped
 * unless RUN_LOCAL_SPEECH_E2E=1 so CI and keyless runs stay green.
 *
 *   1) uv run --directory services/local-tts uvicorn app:app --port 8003
 *   2) uv run --directory services/local-stt uvicorn app:app --port 8002
 *   3) RUN_LOCAL_SPEECH_E2E=1 pnpm --filter api test:e2e
 */
const run = process.env.RUN_LOCAL_SPEECH_E2E === '1';
const baseUrl = process.env.LOCAL_TTS_URL ?? 'http://localhost:8003';
const sttBaseUrl = process.env.LOCAL_STT_URL ?? 'http://localhost:8002';

const audioFormat = {
  encoding: 'pcm16',
  sampleRate: 48000,
  channels: 1,
} as const;

function expectWav(bytes: Uint8Array): void {
  expect(bytes.byteLength).toBeGreaterThan(44);
  expect(Buffer.from(bytes.slice(0, 4)).toString('ascii')).toBe('RIFF');
  expect(Buffer.from(bytes.slice(8, 12)).toString('ascii')).toBe('WAVE');
}

(run ? describe : describe.skip)('local TTS sidecar (real e2e)', () => {
  const provider = new LocalSpeechTtsProvider({ baseUrl });

  it('synthesizes Vietnamese text to wav bytes', async () => {
    expectWav(
      await provider.synthesize({
        text: 'Xin chào, đây là bản dịch tiếng Việt.',
        language: 'vi',
        audioFormat,
      }),
    );
  }, 30_000);

  it('synthesizes English text to wav bytes', async () => {
    expectWav(
      await provider.synthesize({
        text: 'Hello, this is the English translation.',
        language: 'en',
        audioFormat,
      }),
    );
  }, 30_000);

  it('accepts a Vietnamese preset voice by name', async () => {
    expectWav(
      await provider.synthesize({
        text: 'Xin chào.',
        language: 'vi',
        voice: 'Phạm Tuyên',
        audioFormat,
      }),
    );
  }, 30_000);

  it('falls back rather than failing on a voice the engine cannot use', async () => {
    // The web app sends a Vietnamese preset name for en→vi; if the backend
    // changes underneath, a bad voice must not cost the caller their audio.
    expectWav(
      await provider.synthesize({
        text: 'Hello there.',
        language: 'en',
        voice: 'Phạm Tuyên',
        audioFormat,
      }),
    );
  }, 30_000);
});

/**
 * Speech round-trip: synthesize, then transcribe the result back. This is the
 * only automated check that the STT sidecar actually recognises speech — the
 * sidecar's own tests feed it a synthetic tone, for which an empty transcript
 * is a correct answer, so they cannot catch a model that stops working.
 * Needs both sidecars up.
 */
(run ? describe : describe.skip)('local speech round-trip (real e2e)', () => {
  const tts = new LocalSpeechTtsProvider({ baseUrl });
  const stt = new LocalSpeechSttProvider({ baseUrl: sttBaseUrl });

  async function roundTrip(
    text: string,
    language: 'vi' | 'en',
  ): Promise<string> {
    const wav = await tts.synthesize({ text, language, audioFormat });
    const { text: heard } = await stt.transcribe(wav, 'audio/wav', language);
    return heard
      .toLowerCase()
      .replace(/[.,!?]/g, '')
      .trim();
  }

  it('recognises synthesized English', async () => {
    const heard = await roundTrip(
      'The weather is beautiful today and I would like to walk in the park.',
      'en',
    );
    expect(heard).toContain('the weather is beautiful today');
    expect(heard).toContain('walk in the park');
  }, 60_000);

  it('recognises synthesized Vietnamese, sentence-cased not shouting', async () => {
    const wav = await tts.synthesize({
      text: 'Xin chào, hôm nay trời rất đẹp.',
      language: 'vi',
      audioFormat,
    });
    const { text: heard } = await stt.transcribe(wav, 'audio/wav', 'vi');

    expect(heard.toLowerCase()).toContain('xin chào');
    expect(heard.toLowerCase()).toContain('trời rất đẹp');
    // The Vietnamese decoder emits bare uppercase; the sidecar must normalise it
    // because this string is shown to the user.
    expect(heard).not.toBe(heard.toUpperCase());
  }, 60_000);

  it('rejects undecodable audio with a response error, not a hang', async () => {
    await expect(
      stt.transcribe(new Uint8Array([1, 2, 3, 4]), 'audio/wav', 'en'),
    ).rejects.toMatchObject({ status: 400 });
  }, 30_000);
});
