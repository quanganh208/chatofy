import { CONTEXT_LIMITS, type TranslationContext } from '@chatofy/types';

/**
 * The editor's working copy of an AI Context, and the rules that bound it.
 *
 * Pure on purpose: nothing here renders, reads the library or talks to the
 * network, so every refusal below can be exercised without a mount.
 * `ai-context-editor.tsx` is what shows them, and `ai-context-section.tsx` is
 * what sends the result.
 */

/** The editor's working copy — a context being written, not one that is stored. */
export interface Draft {
  /** The client-minted id. Absent for a context that has never been saved. */
  id: string;
  name: string;
  topic: string;
  /** One per line, which is how a person writes a list of names. */
  hotwords: string;
  /** The Glossary to draw preferred renderings from, or null for none. */
  glossaryId: string | null;
  style: 'neutral' | 'formal' | 'casual';
}

export const emptyDraft = (): Draft => ({
  id: crypto.randomUUID(),
  name: '',
  topic: '',
  hotwords: '',
  glossaryId: null,
  style: 'neutral',
});

export const draftOf = (context: TranslationContext): Draft => ({
  id: context.id,
  name: context.name,
  topic: context.topic ?? '',
  hotwords: context.hotwords.join('\n'),
  glossaryId: context.linkedGlossaryId ?? null,
  style: context.style ?? 'neutral',
});

/** One entry per line, blank lines dropped and each trimmed. */
export const hotwordLinesOf = (raw: string): string[] =>
  raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * What a save actually sends. NOT capped here — unlike the glossary, nothing on
 * this field structurally keeps the writer at or under the ceiling as they type,
 * so slicing silently would save a context missing the terms past the cut. The
 * editor instead refuses to save over the limit and says so, the way it already
 * does for an overlong rendering below.
 */
export const keywordsOf = (raw: string): string[] => hotwordLinesOf(raw);

/** One line longer than the contract's per-term character cap. */
export const hotwordTooLong = (raw: string): boolean =>
  hotwordLinesOf(raw).some((line) => line.length > CONTEXT_LIMITS.MAX_HOTWORD_CHARS);

/** More terms than the contract accepts. */
export const tooManyHotwords = (raw: string): boolean =>
  hotwordLinesOf(raw).length > CONTEXT_LIMITS.MAX_HOTWORDS;
