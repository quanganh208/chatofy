// Shared primitive types used across all provider interfaces

// Type-only re-export of the canonical language code from @chatofy/types —
// single source of truth without pulling zod into this package's runtime.
export type { LanguageCode, VoiceGender } from '@chatofy/types';

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
