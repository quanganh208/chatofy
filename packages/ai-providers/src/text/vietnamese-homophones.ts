import { mergeCorrections, type TranscriptCorrection, wordsOf } from './transcript-corrections.js';
import { isNumberWord } from './vietnamese-number-grammar.js';
import { syllableParts, type SyllableParts } from './vietnamese-syllable.js';

/**
 * The deterministic half of homophone repair: what a model's proposal must
 * satisfy before it may replace words on the reader's line.
 *
 * The Vietnamese recognizer hears sounds, and several spellings share one sound.
 * In most of the country "dao", "giao" and "rao" are said alike, as are "triều"
 * and "chiều", so the recognizer picks whichever its training saw more often:
 * a news report on a stabbing came out as "đâm giao", and a flood warning as
 * "chiều cường". Only the sentence tells them apart, and the recognizer decodes
 * without one. A model reads the sentence and proposes the word that fits; this
 * file decides whether to believe it.
 *
 * The model is not trusted, for the reason `loanword-respelling.ts` gives: an
 * answer on this surface reads as the speaker's own words. So a proposal is
 * accepted only when every word it changes SOUNDS like the word it replaces,
 * and differs from it in one way only — its onset, its rhyme or its tone —
 * under the mergers the spoken language really makes. A proposal can then fix
 * what was misheard, and cannot say anything that was not, by the sound of it,
 * said. Every right repair measured differed in exactly one of the three:
 * "giao" → "dao" in the onset, "đinh" → "đỉnh" in the tone.
 *
 * A repair names one place in the transcript, never a word wherever it occurs:
 * "đâm giao rồi giao hàng" has one misheard "giao" and one right one.
 *
 * An accepted repair is a `TranscriptCorrection`, applied to the line by
 * `applyTranscriptCorrections` like any other.
 */

/**
 * One accepted repair: words as heard at one place, and the words said there —
 * always the same number of words.
 */
export type HomophoneRepair = TranscriptCorrection;

/** Longest run of words one repair may cover. */
export const MAX_REPAIR_WORDS = 3;

/**
 * Most repairs one transcript may be proposed.
 *
 * Over this, every proposal is refused, not just the extra ones: a model that
 * finds this many misheard words in one turn is rewriting the sentence, and the
 * first few of its changes are no more trustworthy than the rest. The highest
 * count a right answer reached on the six measured recordings was two.
 */
export const MAX_REPAIRS_PER_TRANSCRIPT = 4;

/**
 * Onsets that sound alike, mapped to one key.
 *
 * - d, gi, r: one sound in the north (/z/), and d and gi one sound in the south.
 * - tr, ch: one sound in the north.
 * - s, x: one sound in the north.
 * - c and k, g and gh, ng and ngh: one sound written two ways by the spelling
 *   rules, so never a confusion of hearing, only of writing.
 */
const ONSET_SOUND: Readonly<Record<string, string>> = {
  gi: 'z',
  d: 'z',
  r: 'z',
  tr: 'ch',
  x: 's',
  k: 'c',
  gh: 'g',
  ngh: 'ng',
};

/**
 * Codas the south merges: final n with ng, final t with c.
 *
 * Only these two, because only these two are mergers of sound rather than of
 * spelling; a rule for "nh" or "ch" would also merge words that sound distinct
 * everywhere.
 */
function codaSound(rhyme: string): string {
  return rhyme.replace(/ng$/u, 'n').replace(/c$/u, 't');
}

/**
 * The onset as spoken. A "g" before "i" is always the onset "gi" — "gì" and
 * "gìn" are written without a second "i", and the velar is written "gh" there —
 * so "gì" sounds like "dì", whatever the parse made of its letters.
 */
function onsetOf(parts: SyllableParts): string {
  return parts.onset === 'g' && parts.rhyme.startsWith('i') ? 'gi' : parts.onset;
}

/**
 * What a syllable sounds like, tone aside, or null when it is not one.
 *
 * Two syllables with the same key are pronounced alike somewhere the language
 * is spoken, apart from their tone.
 */
export function soundKey(word: string): string | null {
  const parts = syllableParts(word);
  if (!parts) return null;
  const onset = onsetOf(parts);
  return `${ONSET_SOUND[onset] ?? onset}|${codaSound(parts.rhyme)}`;
}

/** Onsets that are one sound written two ways, as the one they are spelled for. */
const ONSET_SPELLING: Readonly<Record<string, string>> = { k: 'c', gh: 'g', ngh: 'ng' };

/** The onset with the spelling rules' variants folded away. */
function spokenOnset(parts: SyllableParts): string {
  const onset = onsetOf(parts);
  return ONSET_SPELLING[onset] ?? onset;
}

/**
 * Whether `said` could have been heard as `was`: the same sound key, and a
 * difference in exactly one of onset, rhyme and tone.
 *
 * One, because the mergers are regional and the tone is a separate channel: a
 * pair that needs the north's onsets AND the south's codas AND a different tone
 * ("rán" and "giáng") is a pair no listener confuses. And not none: a change of
 * mark placement ("khóa", "khoá") or of spelling alone ("cá", "ká") repairs
 * nothing anyone heard.
 */
export function soundsAlike(was: string, said: string): boolean {
  const a = syllableParts(was);
  const b = syllableParts(said);
  if (!a || !b || soundKey(was) !== soundKey(said)) return false;
  const differences =
    Number(spokenOnset(a) !== spokenOnset(b)) +
    Number(a.rhyme !== b.rhyme) +
    Number(a.tone !== b.tone);
  return differences === 1;
}

const DIGIT = /\p{N}/u;

/** Every index at which `needle` occurs in `haystack` as consecutive words. */
function occurrences(haystack: readonly string[], needle: readonly string[]): number[] {
  const found: number[] = [];
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((word, offset) => haystack[start + offset] === word)) found.push(start);
  }
  return found;
}

/** A proposal's words when it passes every guard, else null. */
function guarded(transcript: readonly string[], proposal: unknown): HomophoneRepair | null {
  if (typeof proposal !== 'object' || proposal === null) return null;
  const { heard, said } = proposal as { heard?: unknown; said?: unknown };
  if (typeof heard !== 'string' || typeof said !== 'string') return null;
  const heardWords = wordsOf(heard);
  const saidWords = wordsOf(said);
  if (heardWords.length === 0 || heardWords.length > MAX_REPAIR_WORDS) return null;
  // Word for word: a repair that adds or drops a word is an edit of the
  // sentence, not of what one word sounded like.
  if (saidWords.length !== heardWords.length) return null;
  // One place only. A run heard twice cannot say which of the two was
  // misheard, and repairing both changes a word that was heard right.
  const places = occurrences(transcript, heardWords);
  if (places.length !== 1) return null;
  let changed = false;
  for (const [index, word] of saidWords.entries()) {
    const was = heardWords[index]!;
    if (word === was) continue;
    // A quantity is never a sound-alike repair: the ITN turns the word into a
    // digit right after, so "ba chiều" read as "ba triệu" would print 3 triệu.
    if (DIGIT.test(word) || DIGIT.test(was) || isNumberWord(word) || isNumberWord(was)) {
      return null;
    }
    if (!soundsAlike(was, word)) return null;
    changed = true;
  }
  return changed
    ? { heard: heardWords.join(' '), said: saidWords.join(' '), at: places[0]! }
    : null;
}

/**
 * The proposals that pass every guard, in the order given.
 *
 * `proposals` is whatever the model answered, unchecked: anything that is not a
 * `{heard, said}` pair of strings is dropped rather than thrown on. A repair
 * that overlaps one already accepted is dropped too, because two repairs of
 * the same words would compose into a line neither proposed.
 */
export function acceptHomophoneRepairs(
  transcript: string,
  proposals: readonly unknown[],
): HomophoneRepair[] {
  if (proposals.length > MAX_REPAIRS_PER_TRANSCRIPT) return [];
  const words = wordsOf(transcript);
  const repairs = proposals
    .map((proposal) => guarded(words, proposal))
    .filter((repair): repair is HomophoneRepair => repair !== null);
  return mergeCorrections(repairs, []);
}
