import {
  ProviderNotImplementedError,
  ProviderRegistry,
  VieNeuTtsProvider,
  type SttProvider,
  type TtsProvider,
} from '@chatofy/ai-providers';

describe('ProviderRegistry', () => {
  it('resolves a registered provider with the kind-mapped type', () => {
    const registry = new ProviderRegistry();
    registry.register('tts', {
      name: 'vieneu',
      create: (cfg) => new VieNeuTtsProvider(cfg),
    });

    // No caller-side type assertion: 'tts' kind yields TtsProvider.
    const tts: TtsProvider = registry.resolve('tts', 'vieneu', {
      baseUrl: 'http://localhost:8001',
    });
    expect(tts.name).toBe('vieneu');
    expect(tts.outputMimeType).toBe('audio/wav');

    // Kind/type mismatch must fail typecheck — the registry's type map is the guard.
    // @ts-expect-error resolving the 'tts' kind cannot produce an SttProvider
    const wrong: SttProvider = registry.resolve('tts', 'vieneu', {
      baseUrl: 'http://localhost:8001',
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
      name: 'vieneu',
      create: (cfg) => new VieNeuTtsProvider(cfg),
    });

    const names = registry.list('tts');
    expect(names).toEqual(['vieneu']);
    names.push('mutated');
    expect(registry.list('tts')).toEqual(['vieneu']);
  });
});
