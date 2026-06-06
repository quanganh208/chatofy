// Verifies the factory memoizes the provider trio per tier so the GoogleGenAI
// client + its connection pool persist across requests (no per-request `new`).
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest
    .fn()
    .mockImplementation(() => ({ models: { generateContent: jest.fn() } })),
}));

import { GoogleGenAI } from '@google/genai';
import { resolveQualityProfile } from '@chatofy/ai-providers';
import type { ConfigService } from '@nestjs/config';
import { AiProvidersFactory } from './ai-providers.factory';

function makeConfig(
  overrides: Record<string, unknown> = {},
): ConfigService<Record<string, unknown>, true> {
  const map: Record<string, unknown> = {
    AI_STT_PROVIDER: 'elevenlabs',
    AI_TTS_PROVIDER: 'elevenlabs',
    AI_TRANSLATION_PROVIDER: 'gemini',
    ELEVENLABS_API_KEY: 'eleven-key',
    GEMINI_API_KEY: 'gemini-key',
    ELEVENLABS_TTS_VOICE_ID: 'voice-id',
    ...overrides,
  };
  return {
    get: jest.fn((key: string) => map[key]),
  } as unknown as ConfigService<Record<string, unknown>, true>;
}

describe('AiProvidersFactory (memoization)', () => {
  beforeEach(() => (GoogleGenAI as jest.Mock).mockClear());

  it('reuses the same trio instances for the same tier', () => {
    const factory = new AiProvidersFactory(makeConfig());
    const a = factory.makeProviders(resolveQualityProfile(0.5));
    const b = factory.makeProviders(resolveQualityProfile(0.5));

    expect(b.stt).toBe(a.stt);
    expect(b.translation).toBe(a.translation);
    expect(b.tts).toBe(a.tts);
  });

  it('builds the GoogleGenAI client once per distinct tier', () => {
    const factory = new AiProvidersFactory(makeConfig());
    factory.makeProviders(resolveQualityProfile(0.5));
    factory.makeProviders(resolveQualityProfile(0.5));
    factory.makeProviders(resolveQualityProfile(0.5));

    // Three same-tier requests → exactly one client construction.
    expect(GoogleGenAI).toHaveBeenCalledTimes(1);
  });

  it('builds distinct trios for distinct tiers', () => {
    const factory = new AiProvidersFactory(makeConfig());
    const fast = factory.makeProviders(resolveQualityProfile(0.0));
    const balanced = factory.makeProviders(resolveQualityProfile(0.5));

    expect(balanced.translation).not.toBe(fast.translation);
    expect(GoogleGenAI).toHaveBeenCalledTimes(2);
  });

  it('isolates cache per factory instance', () => {
    const a = new AiProvidersFactory(makeConfig()).makeProviders(
      resolveQualityProfile(0.5),
    );
    const b = new AiProvidersFactory(makeConfig()).makeProviders(
      resolveQualityProfile(0.5),
    );
    expect(b.translation).not.toBe(a.translation);
  });
});
