import { describe, expect, it } from 'vitest';
import {
  ProviderNotImplementedError,
  ProviderRegistry,
  LocalSpeechTtsProvider,
  type SttProvider,
  type TtsProvider,
} from '@chatofy/ai-providers';

describe('ProviderRegistry', () => {
  it('resolves a registered provider with the kind-mapped type', () => {
    const registry = new ProviderRegistry();
    registry.register('tts', {
      name: 'local',
      create: (cfg) => new LocalSpeechTtsProvider(cfg),
    });

    // No caller-side type assertion: 'tts' kind yields TtsProvider.
    const tts: TtsProvider = registry.resolve('tts', 'local', {
      baseUrl: 'http://localhost:8003',
    });
    expect(tts.name).toBe('local');
    expect(tts.outputMimeType).toBe('audio/wav');

    // Kind/type mismatch must fail typecheck — the registry's type map is the guard.
    // @ts-expect-error resolving the 'tts' kind cannot produce an SttProvider
    const wrong: SttProvider = registry.resolve('tts', 'local', {
      baseUrl: 'http://localhost:8003',
    });
    expect(wrong).toBeDefined();
  });

  it('throws ProviderNotImplementedError for an unregistered name', () => {
    const registry = new ProviderRegistry();
    expect(() => registry.resolve('stt', 'nope', {})).toThrow(
      ProviderNotImplementedError,
    );
  });

  it('lists registered names without exposing internal state', () => {
    const registry = new ProviderRegistry();
    registry.register('tts', {
      name: 'local',
      create: (cfg) => new LocalSpeechTtsProvider(cfg),
    });

    const names = registry.list('tts');
    expect(names).toEqual(['local']);
    names.push('mutated');
    expect(registry.list('tts')).toEqual(['local']);
  });
});
