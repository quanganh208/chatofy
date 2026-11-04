import { countWords, type TranscriptCorrection } from '@chatofy/ai-providers';
import {
  joinAtSeams,
  type LanguageCode,
  type TranslationHints,
} from '@chatofy/types';
import type { DisplayRestoreRequest } from '../services/pipeline-translator.service';
import type { StreamSocket } from './stream-socket';
import type { SeamEdges } from './turn-audio';

/**
 * The finished segments of each connection, by `segment.sessionId`, so a run of
 * them can be translated again as one text (`client.block.retranslate`).
 *
 * The transcript is the one the server produced, which is the whole point of
 * keeping it here rather than taking it from the client: a block retranslation
 * names segments, and nothing a client types can reach the model through it.
 *
 * Keyed by socket in a `WeakMap`, like {@link ConversationContext}: this is
 * per-connection state, released with the socket itself rather than only when
 * a disconnect handler happens to run.
 */

/**
 * Segments kept per connection. A block is at most `MAX_BLOCK_SEGMENTS` long and
 * is asked for as soon as its last piece lands, so twice that covers a block
 * plus the turns that finished around it while it was being asked for.
 *
 * Also what bounds the audio kept for seam repair: 5 s per segment, about 4 MB
 * per connection at 16 kHz.
 */
const REMEMBERED_SEGMENTS = 24;

/**
 * Languages whose seams are repaired, the two the repair was measured on.
 * Chinese is not one: Paraformer writes no spaces, so a clip has no words to
 * compare at the turns' edges.
 */
const SEAM_REPAIR_LANGUAGES: ReadonlySet<LanguageCode> = new Set(['en', 'vi']);

export interface FinishedSegment {
  sourceText: string;
  recognition: LanguageCode;
  targets: readonly LanguageCode[];
  hints?: TranslationHints;
  /** What the turn asked the display restorer for; absent when it asked nothing. */
  restore?: DisplayRestoreRequest;
  /** Silence before the first word in ms, measured with `restore.pauses`. */
  leadPause?: number;
  /** Guarded spellings the segment's own display applied, keyed by span. */
  respellings?: Readonly<Record<string, string>>;
  /** Guarded corrections the segment's own display applied. */
  corrections?: readonly TranscriptCorrection[];
  /** The segment's audio around its ends, to re-read a cut beside it. */
  seamEdges?: SeamEdges;
  /** Whether the client asked for a display, for a language with no restore too. */
  repairDisplay?: boolean;
}

/** The cut between two neighbouring segments of a block. */
export interface BlockSeam {
  /** The left segment's place in the block. */
  index: number;
  left: string;
  right: string;
  recognition: LanguageCode;
  hints?: TranslationHints;
  sampleRate: number;
  /** PCM16 of the left segment's end, then of the right segment's start. */
  clip: Buffer;
}

/**
 * The pieces' corrections in one list, each moved to its place in the
 * joined text, or nothing when none had any.
 *
 * A repair names a word index in its own piece, so it is shifted by the words
 * of the pieces before it. That keeps it on the word it repaired: piece B may
 * say "giao" too, and heard rightly.
 */
function blockCorrections(found: FinishedSegment[]): {
  corrections?: TranscriptCorrection[];
} {
  const corrections: TranscriptCorrection[] = [];
  let offset = 0;
  for (const segment of found) {
    for (const correction of segment.corrections ?? []) {
      corrections.push({ ...correction, at: correction.at + offset });
    }
    offset += countWords(segment.sourceText);
  }
  return corrections.length > 0 ? { corrections } : {};
}

/** The pieces' accepted spellings in one map, or nothing when none had any. */
function blockRespellings(found: FinishedSegment[]): {
  respellings?: Record<string, string>;
} {
  const respellings = Object.assign(
    {},
    ...found.map((segment) => segment.respellings ?? {}),
  ) as Record<string, string>;
  return Object.keys(respellings).length > 0 ? { respellings } : {};
}

/** A run of segments that can be translated as one text. */
export interface SegmentBlock {
  sourceText: string;
  recognition: LanguageCode;
  targets: LanguageCode[];
  hints?: TranslationHints;
  /** The block's display restore, as its first piece asked for one. */
  restore?: DisplayRestoreRequest;
  /** Every piece's accepted spellings together, so the block keeps them. */
  respellings?: Readonly<Record<string, string>>;
  /** Every piece's corrections together, so the block keeps them. */
  corrections?: readonly TranscriptCorrection[];
  /** Whether a seam repair added words the pieces' own displays do not have. */
  seamRepaired?: boolean;
  /** Whether the client asked for a display. */
  repairDisplay?: boolean;
}

/**
 * Words a seam repair recovered, as a piece of their own between two segments.
 *
 * A piece because everything a block derives from its pieces then stays right
 * with no index arithmetic: the join, the pause per word, and the word offsets
 * of later corrections. No pause is measured for these words, and a zero says
 * nothing to the restorer.
 */
function recoveredPiece(
  sourceText: string,
  like: FinishedSegment,
): FinishedSegment {
  return {
    sourceText,
    recognition: like.recognition,
    targets: like.targets,
    leadPause: 0,
    restore: {
      terms: [],
      pauses: Array.from({ length: countWords(sourceText) }, () => 0),
    },
  };
}

/**
 * The pieces' pauses end to end, or nothing when any piece has none.
 *
 * At each seam the pause is the two halves added: the end of a piece holds the
 * quiet that let the capture gate cut it (~100ms), and the start of the next
 * holds the rest, up to its pre-roll. Read alone, the first half sits under the
 * restorer's gate at every cut, so a full stop at a cut was always dropped.
 */
function blockPauses(found: FinishedSegment[]): { pauses?: number[] } {
  const pauses: number[] = [];
  for (const [index, segment] of found.entries()) {
    const own = segment.restore?.pauses;
    if (!own) return {};
    if (index > 0) {
      if (segment.leadPause === undefined || pauses.length === 0) return {};
      pauses[pauses.length - 1]! += segment.leadPause;
    }
    pauses.push(...own);
  }
  return { pauses };
}

export class FinishedSegments {
  private readonly bySocket = new WeakMap<
    StreamSocket,
    Map<string, FinishedSegment>
  >();

  record(
    socket: StreamSocket,
    segmentId: string,
    segment: FinishedSegment,
  ): void {
    const segments =
      this.bySocket.get(socket) ?? new Map<string, FinishedSegment>();
    segments.delete(segmentId);
    segments.set(segmentId, segment);
    while (segments.size > REMEMBERED_SEGMENTS) {
      const oldest = segments.keys().next().value;
      if (oldest === undefined) break;
      segments.delete(oldest);
    }
    this.bySocket.set(socket, segments);
  }

  /**
   * The source text of up to `count` segments this connection finished before
   * `segmentId`, oldest first: the speech a block continues, for its polish.
   *
   * Never the block's own segments, so a block is not its own context. Empty
   * when `segmentId` is unknown here — a block that cannot name where it starts
   * gets no context rather than some other stretch of the conversation.
   */
  before(socket: StreamSocket, segmentId: string, count = 4): string[] {
    const segments = this.bySocket.get(socket);
    if (!segments?.has(segmentId)) return [];
    const earlier: string[] = [];
    for (const [id, segment] of segments) {
      if (id === segmentId) break;
      if (segment.sourceText.trim()) earlier.push(segment.sourceText);
    }
    return earlier.slice(-count);
  }

  /**
   * The cuts between the named segments that can be re-read: both sides kept
   * their audio at one sample rate, in a language the repair was measured on.
   */
  seams(socket: StreamSocket, segmentIds: readonly string[]): BlockSeam[] {
    const segments = this.bySocket.get(socket);
    const seams: BlockSeam[] = [];
    for (let index = 0; index + 1 < segmentIds.length; index += 1) {
      const left = segments?.get(segmentIds[index]!);
      const right = segments?.get(segmentIds[index + 1]!);
      if (!left?.seamEdges || !right?.seamEdges) continue;
      if (left.seamEdges.sampleRate !== right.seamEdges.sampleRate) continue;
      if (!SEAM_REPAIR_LANGUAGES.has(left.recognition)) continue;
      seams.push({
        index,
        left: left.sourceText,
        right: right.sourceText,
        recognition: left.recognition,
        ...(left.hints ? { hints: left.hints } : {}),
        sampleRate: left.seamEdges.sampleRate,
        clip: Buffer.concat([left.seamEdges.tail, right.seamEdges.head]),
      });
    }
    return seams;
  }

  /**
   * The named segments joined in the order given, or null when any is unknown to
   * this connection, empty, or was spoken in another language or translated into
   * other targets — one translation cannot serve two plans.
   *
   * `recovered` holds words a seam repair found after the segment at each
   * index, joined in as pieces of their own.
   */
  block(
    socket: StreamSocket,
    segmentIds: readonly string[],
    recovered: ReadonlyMap<number, string> = new Map(),
  ): SegmentBlock | null {
    const segments = this.bySocket.get(socket);
    if (!segments || new Set(segmentIds).size !== segmentIds.length)
      return null;
    const found = segmentIds.map((id) => segments.get(id));
    const [first] = found;
    if (!first) return null;
    const sameTargets = (targets: readonly LanguageCode[]) =>
      targets.length === first.targets.length &&
      targets.every((target, index) => target === first.targets[index]);
    for (const segment of found) {
      if (
        !segment?.sourceText.trim() ||
        segment.recognition !== first.recognition ||
        !sameTargets(segment.targets)
      ) {
        return null;
      }
    }
    const pieces = (found as FinishedSegment[]).flatMap((segment, index) => {
      const words = recovered.get(index);
      return words ? [segment, recoveredPiece(words, first)] : [segment];
    });
    return {
      // Joined the way the screen joins them: a closing mark the ceiling forced
      // on a piece would otherwise reach the translator as a sentence break.
      sourceText: joinAtSeams(pieces.map((piece) => piece.sourceText.trim())),
      recognition: first.recognition,
      targets: [...first.targets],
      ...(first.hints ? { hints: first.hints } : {}),
      ...blockRespellings(pieces),
      ...blockCorrections(pieces),
      ...(pieces.length > found.length ? { seamRepaired: true } : {}),
      ...(first.repairDisplay ? { repairDisplay: true } : {}),
      // Terms, and pauses when every piece has them: a block starts a display
      // group, so it continues nothing and the first piece's seam context does
      // not apply to it. The pauses join piece after piece, each seam's
      // split in two and added back together.
      ...(first.restore
        ? {
            restore: {
              terms: first.restore.terms ?? [],
              ...blockPauses(pieces),
            },
          }
        : {}),
    };
  }
}
