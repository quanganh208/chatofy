import { CONTEXT_LIMITS, countTermWords, type TranslationContext } from '@chatofy/types';

/**
 * The editor's working copy of an AI Context, and the rules that bound it.
 *
 * Pure on purpose: nothing here renders, reads the library or talks to the
 * network, so every refusal below can be exercised without a mount.
 * `ai-context-editor.tsx` is what shows them, and `ai-context-section.tsx` is
 * what sends the result.
 *
 * The glossary is a repeating pair of fields, never a free-text blob: an entry is
 * TWO correlated strings, and one box to type both into makes a desynchronized
 * pair representable. The pair is keyed by LANGUAGE rather than by role, so one
 * dictionary serves a conversation running in either direction — which is why the
 * columns are named for the two languages and not for "from" and "to".
 */

/**
 * One row of the glossary as it is being typed.
 *
 * Deliberately not the contract's `GlossaryEntry`, which refuses an empty side:
 * the editor always carries a trailing blank pair so there is somewhere to type,
 * and a row halfway through being filled has one side and not the other.
 * `glossaryOf` is where rows become entries.
 */
export interface GlossaryRow {
  vi: string;
  en: string;
}

/** The editor's working copy — a context being written, not one that is stored. */
export interface Draft {
  /** The client-minted id. Absent for a context that has never been saved. */
  id: string;
  name: string;
  topic: string;
  /** One per line, which is how a person writes a list of names. */
  hotwords: string;
  glossary: GlossaryRow[];
  style: 'neutral' | 'formal' | 'casual';
}

export const emptyDraft = (): Draft => ({
  id: crypto.randomUUID(),
  name: '',
  topic: '',
  hotwords: '',
  glossary: [{ vi: '', en: '' }],
  style: 'neutral',
});

export const draftOf = (context: TranslationContext): Draft => ({
  id: context.id,
  name: context.name,
  topic: context.topic ?? '',
  hotwords: context.hotwords.join('\n'),
  // Always at least one empty row, so the editor opens with somewhere to type
  // rather than with a button that has to be found first.
  glossary: context.glossary.length
    ? context.glossary.map((e) => ({ ...e }))
    : [{ vi: '', en: '' }],
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

/**
 * Whether one side of a pair is a sentence rather than a term.
 *
 * Shown to the writer rather than fixed for them. The contract refuses a side
 * over `MAX_GLOSSARY_TERM_WORDS`, and silently dropping the pair here would save
 * a context missing the entry the person just typed — so the editor names the
 * row and refuses to save until it is shortened.
 *
 * `countTermWords` is the contract's own count, imported rather than
 * reimplemented: a second copy is how the editor's refusal and the schema's come
 * to disagree about the same term.
 *
 * An empty side is not over the cap and is not flagged: the editor always
 * carries a trailing blank pair so there is somewhere to type.
 */
export const sideTooLong = (term: string): boolean =>
  countTermWords(term) > CONTEXT_LIMITS.MAX_GLOSSARY_TERM_WORDS;

export const tooLong = (row: GlossaryRow): boolean => sideTooLong(row.vi) || sideTooLong(row.en);

/**
 * Pairs with both sides filled, capped.
 *
 * A half-filled pair is DROPPED WHOLE rather than saved with one side empty: half
 * a pair names a rendering of nothing, the contract refuses it, and the last row
 * of the editor is empty by design.
 */
export const glossaryOf = (rows: GlossaryRow[]) =>
  rows
    .map((row) => ({ vi: row.vi.trim(), en: row.en.trim() }))
    .filter((row) => row.vi && row.en)
    .slice(0, CONTEXT_LIMITS.MAX_GLOSSARY);
