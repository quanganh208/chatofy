import type { LanguageCode, TranslationHints } from '@chatofy/types';
import type { DisplayRestoreRequest } from '../services/pipeline-translator.service';
import type { StreamSocket } from './stream-socket';

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
 */
const REMEMBERED_SEGMENTS = 24;

export interface FinishedSegment {
  sourceText: string;
  recognition: LanguageCode;
  targets: readonly LanguageCode[];
  hints?: TranslationHints;
  /** What the turn asked the display restorer for; absent when it asked nothing. */
  restore?: DisplayRestoreRequest;
}

/** A run of segments that can be translated as one text. */
export interface SegmentBlock {
  sourceText: string;
  recognition: LanguageCode;
  targets: LanguageCode[];
  hints?: TranslationHints;
  /** The block's display restore, as its first piece asked for one. */
  restore?: DisplayRestoreRequest;
}

/** The pieces' pauses end to end, or nothing when any piece has none. */
function blockPauses(found: FinishedSegment[]): { pauses?: number[] } {
  const each = found.map((segment) => segment.restore?.pauses);
  return each.every((pauses) => pauses !== undefined)
    ? { pauses: each.flatMap((pauses) => pauses) }
    : {};
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
    const segments = this.bySocket.get(socket) ?? new Map();
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
   * The named segments joined in the order given, or null when any is unknown to
   * this connection, empty, or was spoken in another language or translated into
   * other targets — one translation cannot serve two plans.
   */
  block(
    socket: StreamSocket,
    segmentIds: readonly string[],
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
    return {
      sourceText: found.map((segment) => segment!.sourceText.trim()).join(' '),
      recognition: first.recognition,
      targets: [...first.targets],
      ...(first.hints ? { hints: first.hints } : {}),
      // Terms, and pauses when every piece has them: a block starts a display
      // group, so it continues nothing and the first piece's seam context does
      // not apply to it. The pauses join piece after piece, so a piece's last
      // word keeps the silence measured at the end of its own audio — at a
      // forced cut, the speaker had not stopped.
      ...(first.restore
        ? {
            restore: {
              terms: first.restore.terms ?? [],
              ...blockPauses(found as FinishedSegment[]),
            },
          }
        : {}),
    };
  }
}
