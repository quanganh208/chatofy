/**
 * Where one captured turn changes voice, if it does.
 *
 * The gate ends a turn after 500ms of silence, and fast turn-taking — a podcast,
 * an interview — hands over in 300–560ms. Such a turn carries both people, its
 * one vector is a blend of them, and the clusterer can only put it under one
 * name. Measured on a two-host podcast checked against ElevenLabs Scribe: 14 of
 * 26 turns held both voices and the whole conversation came out as one speaker.
 *
 * Shortening the hangover fixed the labels and broke the translation: every
 * mid-sentence pause became a cut, and chrF++ fell by 1–6 points over three
 * recordings. So the turn keeps its length, and this looks INSIDE it for a pause
 * with a different voice on each side. Single-speaker speech almost never shows
 * one (1 split in 38 turns of a Vietnamese monologue), so it is translated
 * exactly as before.
 *
 * The pauses are in the audio the server holds: the capture pump holds silence
 * while it waits to learn whether a pause is internal, and flushes it the moment
 * speech resumes.
 */

/** Frame the level is measured over. */
const FRAME_MS = 20;
/** Floor below which a turn is treated as silent regardless of its own quietest frames. */
const MIN_NOISE_FLOOR = 0.004;
/** Level above the floor that counts as speech — the capture gate's own margin. */
const SPEECH_MARGIN = 0.018;
/**
 * Which quiet frame stands for the turn's room tone. A low percentile rather than
 * the minimum, so one dropout does not set the floor; and computed per turn,
 * because the server has no running floor the way the gate does.
 */
const FLOOR_PERCENTILE = 0.1;

/**
 * Shortest pause that can separate two voices.
 *
 * Handoffs measured on the podcast ran 300–560ms (Scribe word gaps). Shorter
 * silences are mostly inside one speaker's phrasing, and each extra candidate is
 * another sidecar call.
 */
const MIN_SPLIT_PAUSE_MS = 300;

/**
 * Shortest piece whose voice is judged at all.
 *
 * CAM++ on half a second is noisy, and a vector on less decides nothing. Shorter
 * pieces — "Nice.", "What rule?" — ride with the piece before them. That loses
 * the interjections, which are a small share of the time, in exchange for not
 * cutting a sentence on a vector that means nothing.
 */
const MIN_PIECE_MS = 500;

/**
 * Below this cosine, the next piece is someone else.
 *
 * Swept at 0.35/0.40/0.45 over three real recordings: 0.35 made the fewest wrong
 * cuts (4 on the podcast, 0 and 1 on the other two) at no cost in accuracy. It
 * sits between the clusterer's `tauNew` (0.325) and `tauAssign` (0.375).
 */
const SPLIT_COSINE = 0.35;

/**
 * More pieces than this and the turn is left whole. Bounds the sidecar calls one
 * turn can spend; a turn under the 8s ceiling has never come close.
 */
export const MAX_PIECES = 12;

/** A stretch of the turn, in ms from its first byte. */
export interface Span {
  startMs: number;
  endMs: number;
}

/**
 * Pauses of at least {@link MIN_SPLIT_PAUSE_MS} strictly inside the turn.
 *
 * A quiet run touching either end is the pre-roll or the trailing hangover, not
 * a gap between two people, and is never returned.
 */
export function findInternalPauses(pcm: Buffer, sampleRate: number): Span[] {
  const frameSamples = Math.round((sampleRate * FRAME_MS) / 1000);
  const frames = Math.floor(pcm.length / 2 / frameSamples);
  if (frames < 3) return [];

  const rms = new Float64Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    const base = f * frameSamples * 2;
    for (let i = 0; i < frameSamples; i += 1) {
      const sample = pcm.readInt16LE(base + i * 2) / 32768;
      sum += sample * sample;
    }
    rms[f] = Math.sqrt(sum / frameSamples);
  }

  const sorted = Float64Array.from(rms).sort();
  const floor = Math.max(
    MIN_NOISE_FLOOR,
    sorted[Math.floor(FLOOR_PERCENTILE * (frames - 1))] ?? 0,
  );
  const threshold = floor + SPEECH_MARGIN;
  const minFrames = Math.ceil(MIN_SPLIT_PAUSE_MS / FRAME_MS);
  const msAt = (frame: number) =>
    Math.round((frame * frameSamples * 1000) / sampleRate);

  const pauses: Span[] = [];
  let f = 0;
  while (f < frames) {
    if (rms[f]! >= threshold) {
      f += 1;
      continue;
    }
    const start = f;
    while (f < frames && rms[f]! < threshold) f += 1;
    const touchesEdge = start === 0 || f === frames;
    if (!touchesEdge && f - start >= minFrames) {
      // From the sample index, not `f * FRAME_MS`: at a rate that does not
      // divide into 20ms frames, the rounded frame is slightly longer and the
      // difference accumulates over a long turn.
      pauses.push({ startMs: msAt(start), endMs: msAt(f) });
    }
  }
  return pauses;
}

/** The speech between the pauses: one more piece than there are pauses. */
export function piecesBetween(durationMs: number, pauses: Span[]): Span[] {
  const pieces: Span[] = [];
  let startMs = 0;
  for (const pause of pauses) {
    pieces.push({ startMs, endMs: pause.startMs });
    startMs = pause.endMs;
  }
  pieces.push({ startMs, endMs: durationMs });
  return pieces;
}

/** A piece and, if it was long enough to judge, its voice. */
export interface JudgedPiece extends Span {
  vector: number[] | null;
}

/**
 * Group the pieces into runs of one voice, in order.
 *
 * Walks forward keeping the current run's voice as the duration-weighted sum of
 * its judged pieces, and starts a new run when the next judged piece falls below
 * {@link SPLIT_COSINE} against it. Unjudged pieces always join the current run.
 * Measured against re-embedding the whole run at every step, this gives the same
 * accuracy for one sidecar call per piece instead of one per step.
 *
 * Returns the index ranges of the runs, `[first, last]` inclusive.
 */
export function groupByVoice(pieces: JudgedPiece[]): [number, number][] {
  const runs: [number, number][] = [];
  let first = 0;
  let voice: number[] | null = null;

  const fold = (piece: JudgedPiece) => {
    if (!piece.vector) return;
    const weight = piece.endMs - piece.startMs;
    voice ??= new Array<number>(piece.vector.length).fill(0);
    for (let i = 0; i < voice.length; i += 1)
      voice[i]! += piece.vector[i]! * weight;
  };

  fold(pieces[0]!);
  for (let k = 1; k < pieces.length; k += 1) {
    const piece = pieces[k]!;
    if (voice && piece.vector && cosine(voice, piece.vector) < SPLIT_COSINE) {
      runs.push([first, k - 1]);
      first = k;
      voice = null;
    }
    fold(piece);
  }
  runs.push([first, pieces.length - 1]);
  return runs;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 1 : dot / Math.sqrt(na * nb);
}

/** A turn worth planning a split for: at least two pieces long enough to judge. */
export interface SplitCandidate {
  durationMs: number;
  pauses: Span[];
  pieces: Span[];
}

/**
 * Whether this turn could hold a change of voice at all, decided from its audio
 * alone and synchronously — a few milliseconds even at the 60s ceiling.
 *
 * Decided BEFORE anything is spent. Most turns have no internal pause, or only
 * one side long enough to judge; those take the ordinary path untouched, with no
 * sidecar call and no wait.
 */
export function findSplitCandidate(
  pcm: Buffer,
  sampleRate: number,
): SplitCandidate | null {
  const pauses = findInternalPauses(pcm, sampleRate);
  if (pauses.length === 0) return null;
  const durationMs = Math.floor((pcm.length / 2 / sampleRate) * 1000);
  const pieces = piecesBetween(durationMs, pauses);
  if (pieces.length > MAX_PIECES) return null;
  const judgeable = pieces.filter((p) => p.endMs - p.startMs >= MIN_PIECE_MS);
  if (judgeable.length < 2) return null;
  return { durationMs, pauses, pieces };
}

/**
 * Where to cut a candidate turn so each part holds one voice, or null to leave
 * it whole.
 *
 * Cuts land in the middle of the pause between two runs, so no audio is lost at
 * the seam and each side keeps a little of the silence around its words.
 *
 * `embed` is handed a stretch of the turn and returns that piece's vector, or
 * null when it could not get one — a failed call costs the split, never the turn.
 */
export async function planSpeakerSplit(
  { durationMs, pauses, pieces }: SplitCandidate,
  embed: (span: Span) => Promise<number[] | null>,
): Promise<Span[] | null> {
  const vectors = await Promise.all(
    pieces.map((p) =>
      p.endMs - p.startMs >= MIN_PIECE_MS ? embed(p) : Promise.resolve(null),
    ),
  );
  const judged = pieces.map((p, k) => ({ ...p, vector: vectors[k] ?? null }));
  const runs = groupByVoice(judged);
  if (runs.length < 2) return null;

  return runs.map(([first, last], r) => ({
    startMs:
      r === 0
        ? 0
        : Math.round(
            (pauses[first - 1]!.startMs + pauses[first - 1]!.endMs) / 2,
          ),
    endMs:
      r === runs.length - 1
        ? durationMs
        : Math.round((pauses[last]!.startMs + pauses[last]!.endMs) / 2),
  }));
}
