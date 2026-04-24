// ProviderRegistry — register and resolve AI providers by kind + name
import type { ProviderConfig } from '../interfaces/provider-types.js';
import { ProviderNotImplementedError } from '../errors/provider-errors.js';

export type ProviderKind = 'realtime' | 'stt' | 'translation' | 'tts';

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
 *   const stt = registry.resolve<SttProvider>('stt', 'deepgram', config);
 */
export class ProviderRegistry {
  // kind → (name → entry)
  private readonly providers = new Map<ProviderKind, Map<string, ProviderEntry<unknown>>>();

  register<T>(kind: ProviderKind, entry: ProviderEntry<T>): void {
    if (!this.providers.has(kind)) {
      this.providers.set(kind, new Map());
    }
    // Non-null assertion safe: we just set the key above
    this.providers.get(kind)!.set(entry.name, entry as ProviderEntry<unknown>);
  }

  resolve<T>(kind: ProviderKind, name: string, config: ProviderConfig): T {
    const entry = this.providers.get(kind)?.get(name);
    if (!entry) {
      throw new ProviderNotImplementedError(`${kind}:${name}`);
    }
    return entry.create(config) as T;
  }

  list(kind: ProviderKind): string[] {
    const kindMap = this.providers.get(kind);
    if (!kindMap) return [];
    return Array.from(kindMap.keys());
  }
}
