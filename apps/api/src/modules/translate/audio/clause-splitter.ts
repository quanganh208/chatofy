// Splits a translation into the units the streaming path synthesizes one by one.
//
// Why this exists: sherpa-onnx only chunks its own output at SENTENCE
// boundaries, so a one-sentence turn — the common case in a conversation —
// produces a single chunk and gains nothing from streaming synthesis. Splitting
// at clause boundaries in front of the engine is what actually moves
// time-to-first-audio. Measured on this machine, median of 3-5 runs:
//
//   "Hello, how much does this cost?"            0.648s -> 0.340s
//   "Excuse me, could you tell me where ...?"    0.907s -> 0.393s
//   "Tôi muốn đặt một bàn hai người, ..."        1.061s -> 0.813s
//
// In every case the first part's audio outlasts the time needed to synthesize
// the second, so playback runs gapless. Total synthesis time rises ~20-30% from
// per-call overhead, which does not matter: the listener already started.
//
// Splitting mid-clause is deliberately not done — it breaks prosody, and the
// engine renders a fragment with a falling intonation that sounds like an
// interruption.

/**
 * Shortest part worth its own synthesis call.
 *
 * Deliberately small. The measured win came from leading clauses as short as
 * "Hello," (6 chars) and "Xin chào," (9) — a larger floor would merge exactly
 * the split that pays. This only exists to absorb sub-word fragments such as
 * the "Mr." in "Mr. Smith", which cost a whole call and land as a blip.
 */
const MIN_PART_CHARS = 4;

/** ASCII clause and sentence terminators. */
const SPACED_MARKS = ',;:.!?…';

/**
 * Full-width terminators, as Chinese writes them. Chinese puts no space after a
 * mark, and a full-width mark is never part of a number, so these need no
 * lookahead.
 */
const FULL_WIDTH_MARKS = '，。！？；：';

/**
 * Every mark a clause can end on. Exported so a caller that asks "does this
 * text end a clause" reads the same set this splitter cuts on, instead of a
 * copy that forgets the next script.
 */
export const CLAUSE_MARKS = `${SPACED_MARKS}${FULL_WIDTH_MARKS}`;

/**
 * Clause and sentence terminators, kept with the text they follow so the engine
 * still sees the punctuation it takes its intonation from.
 *
 * The trailing lookahead on the ASCII marks is load-bearing: it requires
 * whitespace or end-of-text after the mark, so "3.5" and the Vietnamese decimal
 * comma in "1,5 triệu" are not mistaken for boundaries.
 */
const BOUNDARY = new RegExp(
  `[${SPACED_MARKS}]+(?=\\s|$)|[${FULL_WIDTH_MARKS}]+`,
  'g',
);

/**
 * Break translated text into clause-level synthesis units.
 *
 * Returns a single part when the text has no usable boundary, and an empty
 * array for blank input.
 */
export function splitIntoClauses(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const parts: string[] = [];
  let start = 0;

  // `BOUNDARY` is a module-level regex with /g, so its lastIndex must be reset
  // before each use or successive calls would resume mid-string.
  BOUNDARY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BOUNDARY.exec(trimmed)) !== null) {
    const end = match.index + match[0].length;
    const part = trimmed.slice(start, end).trim();
    if (part) parts.push(part);
    start = end;
  }

  const tail = trimmed.slice(start).trim();
  if (tail) parts.push(tail);

  return absorbFragments(parts);
}

/** Fold parts too short to stand on their own into their neighbour. */
function absorbFragments(parts: string[]): string[] {
  const merged: string[] = [];

  for (const part of parts) {
    const previous = merged[merged.length - 1];
    const tooShort = part.length < MIN_PART_CHARS;
    const previousTooShort =
      previous !== undefined && previous.length < MIN_PART_CHARS;

    if (previous !== undefined && (tooShort || previousTooShort)) {
      // No space after a full-width mark: Chinese writes none there.
      const joiner = FULL_WIDTH_MARKS.includes(previous.slice(-1)) ? '' : ' ';
      merged[merged.length - 1] = `${previous}${joiner}${part}`;
    } else {
      merged.push(part);
    }
  }

  return merged;
}
