import { LocalSpeechTtsProvider } from '@chatofy/ai-providers';

/**
 * Real provider↔sidecar integration check for speech synthesis. Requires the
 * local TTS sidecar running. Skipped unless RUN_LOCAL_SPEECH_E2E=1 so CI and
 * keyless runs stay green.
 *
 *   1) uv run --directory services/local-tts uvicorn app:app --port 8003
 *   2) RUN_LOCAL_SPEECH_E2E=1 pnpm --filter api test:e2e
 */
const run = process.env.RUN_LOCAL_SPEECH_E2E === '1';
const baseUrl = process.env.LOCAL_TTS_URL ?? 'http://localhost:8003';

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
