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

/**
 * Clause and sentence terminators, kept with the text they follow so the engine
 * still sees the punctuation it takes its intonation from.
 *
 * The trailing lookahead is load-bearing: it requires whitespace or end-of-text
 * after the mark, so "3.5" and the Vietnamese decimal comma in "1,5 triệu" are
 * not mistaken for boundaries.
 */
const BOUNDARY = /[,;:.!?…]+(?=\s|$)/g;

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
      merged[merged.length - 1] = `${previous} ${part}`;
    } else {
      merged.push(part);
    }
  }

  return merged;
}
