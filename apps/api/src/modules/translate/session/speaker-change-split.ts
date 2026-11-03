/**
 * Where one captured turn changes voice, if it does.
 *
 * The gate ends a turn after 500ms of silence, and fast turn-taking — a podcast,
 * an interview — hands over in 300–560ms. Such a turn carries both people, its
 * one vector is a blend of them, and the clusterer can only put it under one
 * name. Measured on a two-host podcast checked against the benchmarks' Scribe
 * reference transcript: 14 of 26 turns held both voices and the whole
 * conversation came out as one speaker.
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
 * cutting a sentence on a vector that means nothing. The one exception is a
 * short OPENING, which is compared against the previous turn's voice instead —
 * see {@link MIN_LEAD_MS}.
 */
const MIN_PIECE_MS = 500;

/**
 * Below this cosine, the next piece is someone else.
 *
 * Decoupled from the clusterer's bars, not between them. Re-swept at
 * 0.35/0.40/0.45 (`benchmarks/speaker-id/scripts/split_cosine_sweep.py`) over
 * every saved turn of the same five real recordings the attribution rulers
 * use, once `tauAssign`/`tauNew` moved to 0.50/0.45: on the three sessions with
 * more than one real speaker, summed wrong-cuts + missed-changes was 3 at 0.35,
 * 3 at 0.40, 1 at 0.45 — but 0.45 also cuts once inside a single-voice
 * recording's own turn, which neither 0.35 nor 0.40 does. Nothing beat 0.35 on
 * both counts at once, so it stayed. A value here that happened to fall inside
 * the clusterer's dead zone was always a coincidence, not a design constraint —
 * the two decisions run over different evidence (whole turns with a 300ms
 * speech gate, versus sub-turn pieces with no gate of their own) and have no
 * reason to share a number.
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
  /**
   * The previous turn's speaker said this: a short opening the ceiling cut off
   * the end of their sentence ("…discuss it with | friends. Absolutely."). The
   * piece is too short to carry a vector of its own that a clusterer could
   * trust, so it is attributed with the previous turn's voice instead.
   */
  continuesPrevious?: true;
  /**
   * A short closing piece whose speaker is decided by the NEXT turn: the voice
   * it is closer to — that turn's or the rest of this one — is the one it is
   * attributed with. Its words and translation go out at once like any piece;
   * only its label waits.
   */
  awaitsNextVoice?: {
    /**
     * What it is sent with when no next voice decides it: `rest` for a piece
     * carved off a run it used to ride with, `own` for one the ordinary
     * judgement had already cut off as a different voice.
     */
    fallback: 'own' | 'rest';
  };
}

/**
 * Shortest edge piece — an opening or a closing — compared against a
 * neighbouring turn's voice.
 *
 * Below {@link MIN_PIECE_MS} a vector cannot be trusted against a threshold —
 * measured on Scribe-diarized recordings, a 150–500 ms piece's cosine to its
 * own speaker's speech had a 10th percentile of 0.03–0.20 — but it can still be
 * trusted in a COMPARISON between two voices (31 of 36 right). Under 200 ms
 * nothing was measured.
 */
const MIN_LEAD_MS = 200;
/*
 * Which edge pieces count as short is read two ways. The floor is the piece's
 * span, as measured: the replays placed openings right down to one holding
 * 140 ms of voice in a 260 ms span. The ceiling is its VOICE, because an edge
 * piece also holds the pre-roll or the hangover: "Perfect." in prod spanned
 * 650 ms, was judged on its own vector, and that vector put it on the wrong
 * speaker — about 400 ms of it was voice.
 */

/**
 * Pauses of at least {@link MIN_SPLIT_PAUSE_MS} strictly inside the turn.
 *
 * A quiet run touching either end is the pre-roll or the trailing hangover, not
 * a gap between two people, and is never returned.
 */
export function findInternalPauses(pcm: Buffer, sampleRate: number): Span[] {
  const levels = measureLevels(pcm, sampleRate);
  return levels ? pausesIn(levels) : [];
}

/** Each frame's level and the turn's own speech threshold. */
interface Levels {
  rms: Float64Array;
  threshold: number;
  frameSamples: number;
  sampleRate: number;
}

function measureLevels(pcm: Buffer, sampleRate: number): Levels | null {
  const frameSamples = Math.round((sampleRate * FRAME_MS) / 1000);
  const frames = Math.floor(pcm.length / 2 / frameSamples);
  if (frames < 3) return null;

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
  return { rms, threshold: floor + SPEECH_MARGIN, frameSamples, sampleRate };
}

/** From the sample index, not `frame × FRAME_MS`, so a long turn does not drift. */
function msAtFrame(
  { frameSamples, sampleRate }: Levels,
  frame: number,
): number {
  return Math.round((frame * frameSamples * 1000) / sampleRate);
}

function pausesIn(levels: Levels): Span[] {
  const { rms, threshold } = levels;
  const frames = rms.length;
  const minFrames = Math.ceil(MIN_SPLIT_PAUSE_MS / FRAME_MS);
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
      pauses.push({
        startMs: msAtFrame(levels, start),
        endMs: msAtFrame(levels, f),
      });
    }
  }
  return pauses;
}

/** The voice inside a span: from its first frame over the threshold to its last. */
function speechMsIn(levels: Levels, span: Span): number {
  const { rms, threshold, frameSamples, sampleRate } = levels;
  const frameAt = (ms: number) =>
    Math.min(rms.length, Math.floor((ms * sampleRate) / 1000 / frameSamples));
  let first = -1;
  let last = -1;
  for (let f = frameAt(span.startMs); f < frameAt(span.endMs); f += 1) {
    if (rms[f]! < threshold) continue;
    if (first < 0) first = f;
    last = f;
  }
  return first < 0 ? 0 : msAtFrame(levels, last + 1) - msAtFrame(levels, first);
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

/**
 * Whether a short opening sounds more like the previous turn than like the rest
 * of its own run.
 *
 * Today such a piece always rides with the run after it. Replayed through the
 * capture pump over eight Scribe-diarized recordings, 7 of 12 short openings
 * were then on the wrong speaker — a ceiling cut leaves the end of one person's
 * sentence at the start of the next turn, right before the other person
 * answers. Comparing the two voices moved 7: 5 fixed, none broken, and 2 whose
 * speaker was the same either way.
 */
function opensWithPreviousVoice(
  lead: number[],
  previous: readonly number[],
  judged: JudgedPiece[],
  runs: [number, number][],
): boolean {
  // The voice the opening would otherwise be heard with: the run that piece 1
  // belongs to, without the opening itself.
  const [first, last] = runs.find(([f, l]) => f <= 1 && 1 <= l) ?? [1, 0];
  let rest: number[] | null = null;
  for (let k = Math.max(first, 1); k <= last; k += 1) {
    const piece = judged[k]!;
    if (!piece.vector) continue;
    const weight = piece.endMs - piece.startMs;
    rest ??= new Array<number>(piece.vector.length).fill(0);
    for (let i = 0; i < rest.length; i += 1)
      rest[i]! += piece.vector[i]! * weight;
  }
  if (!rest) return false;
  return cosine(lead, [...previous]) > cosine(lead, rest);
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
  /** Voice inside the first and the last piece, pre-roll and hangover left out. */
  edgeSpeechMs: readonly [number, number];
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
  { hasPreviousVoice = false }: { hasPreviousVoice?: boolean } = {},
): SplitCandidate | null {
  const levels = measureLevels(pcm, sampleRate);
  if (!levels) return null;
  const pauses = pausesIn(levels);
  if (pauses.length === 0) return null;
  const durationMs = Math.floor((pcm.length / 2 / sampleRate) * 1000);
  const pieces = piecesBetween(durationMs, pauses);
  if (pieces.length > MAX_PIECES) return null;
  const edgeSpeechMs = [
    speechMsIn(levels, pieces[0]!),
    speechMsIn(levels, pieces[pieces.length - 1]!),
  ] as const;
  const first = pieces[0]!;
  const last = pieces[pieces.length - 1]!;
  const candidate = { durationMs, pauses, pieces, edgeSpeechMs };
  const judgeable = pieces.filter((p) => p.endMs - p.startMs >= MIN_PIECE_MS);
  if (judgeable.length >= 2) return candidate;
  if (judgeable.length !== 1) return null;
  // One voice to judge inside the turn, but a short edge that may belong to a
  // neighbouring turn: an opening when the turn before has a voice to compare
  // with, and a closing always, because the turn after will.
  if (hasPreviousVoice && isShortEdge(first, edgeSpeechMs[0])) return candidate;
  if (isShortEdge(last, edgeSpeechMs[1])) return candidate;
  return null;
}

/** Too little voice to judge alone, yet enough audio to compare. */
function isShortEdge(piece: Span, speechMs: number): boolean {
  return piece.endMs - piece.startMs >= MIN_LEAD_MS && speechMs < MIN_PIECE_MS;
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
  { durationMs, pauses, pieces, edgeSpeechMs }: SplitCandidate,
  embed: (span: Span) => Promise<number[] | null>,
  previousVoice: readonly number[] | null = null,
): Promise<Span[] | null> {
  const lastIndex = pieces.length - 1;
  const judgedAlone = (k: number) =>
    pieces[k]!.endMs - pieces[k]!.startMs >= MIN_PIECE_MS;
  const compareLead =
    previousVoice !== null &&
    lastIndex > 0 &&
    isShortEdge(pieces[0]!, edgeSpeechMs[0]);
  const [vectors, leadOnly] = await Promise.all([
    Promise.all(
      pieces.map((p, k) => (judgedAlone(k) ? embed(p) : Promise.resolve(null))),
    ),
    // An opening too short to be judged still gets a vector to compare with.
    compareLead && !judgedAlone(0) ? embed(pieces[0]!) : Promise.resolve(null),
  ]);
  const judged = pieces.map((p, k) => ({ ...p, vector: vectors[k] ?? null }));
  const runs = groupByVoice(judged);

  const leadVector = leadOnly ?? (compareLead ? judged[0]!.vector : null);
  const leadIsPrevious =
    leadVector !== null &&
    opensWithPreviousVoice(leadVector, previousVoice!, judged, runs);
  if (leadIsPrevious) {
    // Already alone when the ordinary judgement cut it off; carved off if not.
    const [, last] = runs[0]!;
    if (last > 0) runs.splice(0, 1, [0, 0], [1, last]);
  }

  // A short closing waits for the next turn to decide whose it is: carved off
  // the run it used to ride with, or, when the ordinary judgement had already
  // cut it off on its own noisy vector, kept apart and marked the same way.
  let tail: Span['awaitsNextVoice'];
  if (lastIndex > 0 && isShortEdge(pieces[lastIndex]!, edgeSpeechMs[1])) {
    const [tailFirst] = runs[runs.length - 1]!;
    if (tailFirst < lastIndex) {
      runs.splice(
        runs.length - 1,
        1,
        [tailFirst, lastIndex - 1],
        [lastIndex, lastIndex],
      );
      tail = { fallback: 'rest' };
    } else {
      tail = { fallback: 'own' };
    }
  }
  if (runs.length < 2) return null;

  return runs.map(([first, last], r) => ({
    ...(r === 0 && leadIsPrevious ? { continuesPrevious: true as const } : {}),
    ...(r === runs.length - 1 && tail ? { awaitsNextVoice: tail } : {}),
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
