/**
 * What a room event says about the languages present, read without trusting it.
 *
 * Each participant's spoken language tells this speaker's translation which
 * languages to produce. It arrives as an optional `sourceLanguage` on the join
 * reply's peers and on `conference.peer.joined`; an older server sends neither,
 * so a missing or unknown value is `undefined`, never a guess.
 *
 * Pure (no React Native imports), so it runs under `node --test`.
 */

import { languageCodeSchema, type LanguageCode } from '@chatofy/types/domain';

/** The peer's spoken language from an event or join-reply entry, if it names a supported one. */
export function peerSourceLanguage(data: unknown): LanguageCode | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const parsed = languageCodeSchema.safeParse((data as Record<string, unknown>).sourceLanguage);
  return parsed.success ? parsed.data : undefined;
}

/** The spoken language of each other participant: the languages this speaker translates into. */
export class PeerLanguages {
  private readonly bySocket = new Map<string, LanguageCode>();
  private readonly onChange: (languages: LanguageCode[]) => void;

  /** `onChange` hears the full set whenever a peer's language is recorded or forgotten. */
  constructor(onChange: (languages: LanguageCode[]) => void) {
    this.onChange = onChange;
  }

  /** Record (or, with `undefined`, forget) one peer's language. Bound: pass it as a callback. */
  set = (socketId: string, language: LanguageCode | undefined): void => {
    if (language === undefined) {
      if (!this.bySocket.delete(socketId)) return;
    } else {
      if (this.bySocket.get(socketId) === language) return;
      this.bySocket.set(socketId, language);
    }
    this.onChange(this.values());
  };

  values(): LanguageCode[] {
    return [...this.bySocket.values()];
  }

  clear(): void {
    this.bySocket.clear();
  }
}
