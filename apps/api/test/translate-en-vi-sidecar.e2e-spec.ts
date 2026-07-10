import { VieNeuTtsProvider } from '@chatofy/ai-providers';

/**
 * Real provider↔sidecar integration check for the en→vi path. Requires the
 * VieNeu sidecar (services/vieneu-tts) running. Skipped unless RUN_VIENEU_E2E=1
 * so CI and keyless runs stay green.
 *
 *   1) cd services/vieneu-tts && uv run uvicorn app:app --port 8001
 *   2) RUN_VIENEU_E2E=1 VIENEU_TTS_URL=http://localhost:8001 pnpm --filter api test:e2e
 */
const run = process.env.RUN_VIENEU_E2E === '1';
const baseUrl = process.env.VIENEU_TTS_URL ?? 'http://localhost:8001';

(run ? describe : describe.skip)('VieNeu sidecar (real e2e)', () => {
  it('synthesizes Vietnamese text to wav bytes', async () => {
    const provider = new VieNeuTtsProvider({ baseUrl, voice: 'Phạm Tuyên' });
    const bytes = await provider.synthesize({
      text: 'Xin chào, đây là bản dịch tiếng Việt.',
      language: 'vi',
      audioFormat: { encoding: 'pcm16', sampleRate: 48000, channels: 1 },
    });

    expect(bytes.byteLength).toBeGreaterThan(44);
    // RIFF/WAVE header from the sidecar.
    expect(Buffer.from(bytes.slice(0, 4)).toString('ascii')).toBe('RIFF');
  }, 30_000);
});
