// ProviderRegistry — register and resolve AI providers by kind + name
import type { ProviderConfig } from '../interfaces/provider-types.js';
import type { RealtimeProvider } from '../interfaces/realtime-provider.js';
import type { SpeakerEmbeddingProvider } from '../interfaces/speaker-embedding-provider.js';
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
  speakerEmbedding: SpeakerEmbeddingProvider;
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

  /**
   * Resolve a kind that has exactly one implementation, without naming it.
   *
   * For a kind where the choice is not the caller's to make. A registry is keyed
   * by name, so the name has to appear in `register()` — but repeating it at the
   * resolve site makes the same string load-bearing in two places, and forces
   * whichever module resolves to import from the composition root that
   * registered it. That dependency points the wrong way.
   *
   * Deliberately NOT "take the first one". Registration order is not a decision
   * anyone made, and silently picking one of several would let a second backend
   * change what a caller gets without a single line of that caller changing —
   * which, for a kind whose output is being measured, corrupts the measurement
   * rather than breaking the build. So several is an error, and it names them:
   * the moment a second one exists, someone has to decide how to choose, and
   * that is exactly when they should be made to.
   */
  resolveOnly<K extends ProviderKind>(kind: K, config: ProviderConfig): ProviderKindMap[K] {
    const names = this.list(kind);
    const only = names[0];
    if (names.length !== 1 || only === undefined) {
      throw new ProviderNotImplementedError(
        names.length === 0
          ? `${kind}: none registered`
          : `${kind}: ${names.length} registered (${names.join(', ')}); resolve by name instead`,
      );
    }
    return this.resolve(kind, only, config);
  }

  list(kind: ProviderKind): string[] {
    const kindMap = this.providers.get(kind);
    if (!kindMap) return [];
    return Array.from(kindMap.keys());
  }
}
