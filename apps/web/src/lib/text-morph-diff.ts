/**
 * How to turn the text on screen into a new text one grapheme at a time, by
 * erasing and retyping only the words that differ.
 *
 * Why words, and why in place: measured on a real conversation, the recogniser's
 * commonest revision changes one or two words near the START of the line and
 * leaves the rest alone (88 of 144). Backspacing from the end of the line to the
 * first difference would erase and retype everything after it — that version
 * was measured too, and left the line 3.8 s behind at p95. Aligning the two
 * texts word by word lets each changed word be erased and retyped where it
 * stands while the words around it stay still.
 *
 * Pure: the reveal engine calls it once per frame, and nothing here knows about
 * time.
 */

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The user-perceived characters of `text`, unnormalized, joining back to `text`. */
export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/** One stretch of the text: either the same on both sides, or a change. */
export type MorphSegment =
  | { kind: 'keep'; text: string }
  | {
      kind: 'change';
      /** Graphemes on screen that are not in the target, erased right to left. */
      remove: string[];
      /** Graphemes of the target not yet on screen, typed left to right. */
      insert: string[];
    };

/** Words and the whitespace between them, joining back to exactly `text`. */
function tokens(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

/**
 * Longest common subsequence of two token lists, as matched index pairs.
 *
 * The shared head and tail are matched first and only the middle goes through
 * the table. A finished block can run to hundreds of tokens, and a revision
 * rarely touches more than a few in the middle, so the quadratic part stays
 * small for the lines that are long.
 */
function alignTokens(from: string[], to: string[]): [number, number][] {
  let head = 0;
  while (head < from.length && head < to.length && from[head] === to[head]) head++;
  let tail = 0;
  while (
    tail < from.length - head &&
    tail < to.length - head &&
    from[from.length - 1 - tail] === to[to.length - 1 - tail]
  ) {
    tail++;
  }
  const middle = alignMiddle(
    from.slice(head, from.length - tail),
    to.slice(head, to.length - tail),
  );
  return [
    ...Array.from({ length: head }, (_, k): [number, number] => [k, k]),
    ...middle.map(([i, j]): [number, number] => [i + head, j + head]),
    ...Array.from({ length: tail }, (_, k): [number, number] => [
      from.length - tail + k,
      to.length - tail + k,
    ]),
  ];
}

function alignMiddle(from: string[], to: string[]): [number, number][] {
  const rows = from.length;
  const cols = to.length;
  // Suffix table: lengths[i][j] is the LCS of from[i..] and to[j..].
  const lengths = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      lengths[i]![j] =
        from[i] === to[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (from[i] === to[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

function pushKeep(segments: MorphSegment[], text: string) {
  if (text === '') return;
  const last = segments[segments.length - 1];
  if (last?.kind === 'keep') last.text += text;
  else segments.push({ kind: 'keep', text });
}

/**
 * A change from `shown` to `target`, trimmed to what genuinely differs.
 *
 * The shared grapheme prefix is kept rather than erased: a word still being
 * typed (`chà` on the way to `chào`) is a prefix of its target, and erasing it
 * to retype it would be exactly the flicker this exists to avoid.
 */
function pushChange(segments: MorphSegment[], shown: string, target: string) {
  const from = graphemes(shown);
  const to = graphemes(target);
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++;
  pushKeep(segments, from.slice(0, shared).join(''));
  if (shared < from.length || shared < to.length) {
    segments.push({ kind: 'change', remove: from.slice(shared), insert: to.slice(shared) });
  }
}

/**
 * Put the space of a pure insertion BEFORE the inserted word, not after it.
 *
 * The alignment matches spaces as readily as words, so `Hello my` becoming
 * `Hi there my` keeps the space after `Hi` and inserts `there ` — whose space is
 * typed last, leaving `Hi thmy` on screen for a few frames. Rotating it to
 * insert ` there` before the kept space types `Hi th my` instead. Same text when
 * finished, and every frame on the way reads as words.
 */
function spaceBeforeInsertions(segments: MorphSegment[]): MorphSegment[] {
  segments.forEach((segment, index) => {
    const previous = segments[index - 1];
    if (segment.kind !== 'change' || segment.remove.length > 0 || previous?.kind !== 'keep') return;
    const trailing = segment.insert.join('').match(/\s+$/)?.[0];
    if (!trailing || !previous.text.endsWith(trailing)) return;
    const word = segment.insert.join('').slice(0, -trailing.length);
    previous.text = previous.text.slice(0, -trailing.length);
    segment.insert = graphemes(trailing + word);
    const next = segments[index + 1];
    if (next?.kind === 'keep') next.text = trailing + next.text;
    else segments.splice(index + 1, 0, { kind: 'keep', text: trailing });
  });
  return segments.filter((segment) => segment.kind !== 'keep' || segment.text !== '');
}

/** The steps from `shown` to `target`, in reading order. */
export function morphSegments(shown: string, target: string): MorphSegment[] {
  const from = tokens(shown);
  const to = tokens(target);
  const segments: MorphSegment[] = [];
  let i = 0;
  let j = 0;
  const anchors: [number, number][] = [...alignTokens(from, to), [from.length, to.length]];
  for (const [matchFrom, matchTo] of anchors) {
    if (i < matchFrom || j < matchTo) {
      pushChange(segments, from.slice(i, matchFrom).join(''), to.slice(j, matchTo).join(''));
    }
    const kept = from[matchFrom];
    if (kept !== undefined) pushKeep(segments, kept);
    i = matchFrom + 1;
    j = matchTo + 1;
  }
  return spaceBeforeInsertions(segments);
}

/** Graphemes still to erase or type before `shown` reads as `target`. */
export function morphSteps(segments: MorphSegment[]): number {
  return segments.reduce(
    (total, segment) =>
      segment.kind === 'change' ? total + segment.remove.length + segment.insert.length : total,
    0,
  );
}

/**
 * Spend `count` steps, leftmost change first, and return the new text.
 *
 * Inside one change every stale grapheme is erased — from its right end, as a
 * backspace would — before any replacement is typed, so a wrong word is never
 * left standing beside half of the right one. A change that is pure typing (the
 * end of a growing line) is the same rule with nothing to erase, which is why a
 * line that only grows types exactly as it always did.
 */
export function applyMorphSteps(segments: MorphSegment[], count: number): string {
  let budget = count;
  let text = '';
  for (const segment of segments) {
    if (segment.kind === 'keep') {
      text += segment.text;
      continue;
    }
    const erased = Math.min(budget, segment.remove.length);
    budget -= erased;
    const remaining = segment.remove.slice(0, segment.remove.length - erased);
    if (remaining.length > 0) {
      text += remaining.join('');
      continue;
    }
    const typed = Math.min(budget, segment.insert.length);
    budget -= typed;
    text += segment.insert.slice(0, typed).join('');
  }
  return text;
}
