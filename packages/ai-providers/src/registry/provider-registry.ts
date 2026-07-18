// ProviderRegistry — register and resolve AI providers by kind + name
import type { ProviderConfig } from '../interfaces/provider-types.js';
import type { RealtimeProvider } from '../interfaces/realtime-provider.js';
import type { SttProvider } from '../interfaces/stt-provider.js';
import type { TranslationProvider } from '../interfaces/translation-provider.js';
import type { TtsProvider } from '../interfaces/tts-provider.js';
import { ProviderNotImplementedError } from '../errors/provider-errors.js';

/**
 * Kind → provider interface mapping. Keeps `resolve` honest: the returned type
 * is derived from the kind, so a caller cannot assert a mismatched interface.
 */
export interface ProviderKindMap {
  realtime: RealtimeProvider;
  stt: SttProvider;
  translation: TranslationProvider;
  tts: TtsProvider;
}

export type ProviderKind = keyof ProviderKindMap;

export interface ProviderEntry<T> {
  name: string;
  create: (config: ProviderConfig) => T;
}

/**
 * Central registry for AI provider implementations.
 * Apps register concrete providers at startup; services resolve by name at runtime.
 *
 * Usage:
 *   registry.register('stt', { name: 'deepgram', create: (cfg) => new DeepgramSttProvider(cfg) });
 *   const stt = registry.resolve('stt', 'deepgram', config); // typed SttProvider
 */
export class ProviderRegistry {
  // kind → (name → entry)
  private readonly providers = new Map<ProviderKind, Map<string, ProviderEntry<unknown>>>();

  register<K extends ProviderKind>(kind: K, entry: ProviderEntry<ProviderKindMap[K]>): void {
    if (!this.providers.has(kind)) {
      this.providers.set(kind, new Map());
    }
    // Non-null assertion safe: we just set the key above
    this.providers.get(kind)!.set(entry.name, entry as ProviderEntry<unknown>);
  }

  resolve<K extends ProviderKind>(
    kind: K,
    name: string,
    config: ProviderConfig,
  ): ProviderKindMap[K] {
    const entry = this.providers.get(kind)?.get(name);
    if (!entry) {
      throw new ProviderNotImplementedError(`${kind}:${name}`);
    }
    // Safe: register() only accepts entries whose create() returns the
    // kind-mapped interface, so the stored entry matches K.
    return entry.create(config) as ProviderKindMap[K];
  }

  list(kind: ProviderKind): string[] {
    const kindMap = this.providers.get(kind);
    if (!kindMap) return [];
    return Array.from(kindMap.keys());
  }
}
