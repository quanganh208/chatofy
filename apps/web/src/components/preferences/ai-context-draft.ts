import {
  CONTEXT_LIMITS,
  countTermWords,
  LANGUAGE_CODES,
  type GlossaryEntry,
  type LanguageCode,
  type LanguageTable,
  type TranslationContext,
} from '@chatofy/types';

/**
 * The editor's working copy of an AI Context, and the rules that bound it.
 *
 * Pure on purpose: nothing here renders, reads the library or talks to the
 * network, so every refusal below can be exercised without a mount.
 * `ai-context-editor.tsx` is what shows them, and `ai-context-section.tsx` is
 * what sends the result.
 *
 * The glossary is a repeating row of fields, never a free-text blob: an entry is
 * several correlated strings, and one box to type them all into makes a
 * desynchronized set representable. A row is keyed by LANGUAGE rather than by
 * role, so one dictionary serves a conversation running in any direction — which
 * is why the fields are named for registry languages and not for "from" and "to".
 */

/**
 * One row of the glossary as it is being typed: a value for EVERY registry
 * language, so the editor always has somewhere to type each one.
 *
 * Deliberately not the contract's `GlossaryEntry`, which is a PARTIAL map that
 * refuses a row with fewer than two sides filled: the editor always carries a
 * trailing blank row so there is somewhere to type, and a row halfway through
 * being filled has some sides and not others. `glossaryOf` is where rows become
 * entries.
 */
export type GlossaryRow = LanguageTable<string>;

/** A row with every registry language present and empty. */
const emptyRow = (): GlossaryRow =>
  Object.fromEntries(LANGUAGE_CODES.map((code) => [code, ''])) as GlossaryRow;

/** A stored entry, widened to a row: every registry language present, missing ones blank. */
const rowOf = (entry: GlossaryEntry): GlossaryRow =>
  Object.fromEntries(LANGUAGE_CODES.map((code) => [code, entry[code] ?? ''])) as GlossaryRow;

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
  glossary: [emptyRow()],
  style: 'neutral',
});

export const draftOf = (context: TranslationContext): Draft => ({
  id: context.id,
  name: context.name,
  topic: context.topic ?? '',
  hotwords: context.hotwords.join('\n'),
  // Always at least one empty row, so the editor opens with somewhere to type
  // rather than with a button that has to be found first.
  glossary: context.glossary.length ? context.glossary.map(rowOf) : [emptyRow()],
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
 * Whether one side of a row is a sentence rather than a term.
 *
 * Shown to the writer rather than fixed for them. The contract refuses a side
 * over `MAX_GLOSSARY_TERM_WORDS`, and silently dropping the entry here would
 * save a context missing the rendering the person just typed — so the editor
 * names the row and refuses to save until it is shortened.
 *
 * `countTermWords` is the contract's own count, imported rather than
 * reimplemented: a second copy is how the editor's refusal and the schema's come
 * to disagree about the same term.
 *
 * An empty side is not over the cap and is not flagged: the editor always
 * carries a trailing blank row so there is somewhere to type, and a row may
 * legitimately leave a language unfilled.
 */
export const sideTooLong = (term: string): boolean =>
  countTermWords(term) > CONTEXT_LIMITS.MAX_GLOSSARY_TERM_WORDS;

export const tooLong = (row: GlossaryRow): boolean =>
  LANGUAGE_CODES.some((code) => sideTooLong(row[code]));

/**
 * Rows narrowed to the contract's map, with fewer than two sides dropped whole
 * and the result capped.
 *
 * A row short of two filled sides is DROPPED WHOLE rather than saved with a
 * single language: a rendering in only one language is a rendering of nothing,
 * the contract refuses it, and the last row of the editor is empty by design.
 */
export const glossaryOf = (rows: GlossaryRow[]): GlossaryEntry[] =>
  rows
    .map(
      (row) =>
        Object.fromEntries(
          LANGUAGE_CODES.map((code): [LanguageCode, string] => [code, row[code].trim()]).filter(
            ([, term]) => term,
          ),
        ) as GlossaryEntry,
    )
    .filter((entry) => Object.keys(entry).length >= 2)
    .slice(0, CONTEXT_LIMITS.MAX_GLOSSARY);
