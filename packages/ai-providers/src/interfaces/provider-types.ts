// Shared primitive types used across all provider interfaces

// Type-only re-export of the canonical language code from @chatofy/types —
// single source of truth without pulling zod into this package's runtime.
//
// `GlossaryEntry` travels the same way: a map per language, present in at least
// two, keyed by LANGUAGE rather than by role — see `translation-provider.ts` for
// why the pair is not named `{source, target}` — with the socket's own
// `glossaryEntrySchema` as the one place that enforces the shape.
export type { GlossaryEntry, LanguageCode, VoiceGender } from '@chatofy/types';

export interface AudioFormat {
  encoding: 'pcm16' | 'opus' | 'mulaw';
  sampleRate: number;
  channels: 1 | 2;
}

/** Opaque handle to an active streaming session. */
export interface StreamHandle {
  readonly id: string;
  close(): Promise<void>;
}

/** Open-ended config bag — concrete providers define their own subtypes. */
export interface ProviderConfig {
  [key: string]: unknown;
}
