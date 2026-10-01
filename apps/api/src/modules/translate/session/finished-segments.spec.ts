import { describe, expect, it } from 'vitest';
import type { StreamSocket } from './stream-socket';
import { FinishedSegments, type FinishedSegment } from './finished-segments';

const socket = {} as StreamSocket;
const segment = (
  sourceText: string,
  pauses?: number[],
  leadPause?: number,
): FinishedSegment => ({
  sourceText,
  recognition: 'vi',
  targets: ['en'],
  restore: { terms: [], ...(pauses ? { pauses } : {}) },
  ...(leadPause === undefined ? {} : { leadPause }),
});

describe('FinishedSegments block pauses', () => {
  it("joins the pieces' pauses end to end, each seam's two halves added", () => {
    const finished = new FinishedSegments();
    // The cut fired 90ms into a pause; the next piece opened 280ms before speech.
    finished.record(socket, 'a', segment('cuộc thử nghiệm', [0, 0, 90], 0));
    finished.record(socket, 'b', segment('trong một bài', [0, 0, 400], 280));

    expect(finished.block(socket, ['a', 'b'])?.restore).toEqual({
      terms: [],
      pauses: [0, 0, 370, 0, 0, 400],
    });
  });

  it('ignores the first piece’s own lead: nothing is joined in front of it', () => {
    const finished = new FinishedSegments();
    finished.record(socket, 'a', segment('xin chào', [0, 10], 900));
    finished.record(socket, 'b', segment('anh', [400], 0));

    expect(finished.block(socket, ['a', 'b'])?.restore?.pauses).toEqual([
      0, 10, 400,
    ]);
  });

  it('sends no pauses when any piece has none, rather than misalign them', () => {
    const finished = new FinishedSegments();
    finished.record(socket, 'a', segment('xin chào anh', [0, 0, 10], 0));
    finished.record(socket, 'b', segment('tuấn anh'));

    expect(finished.block(socket, ['a', 'b'])?.restore).toEqual({ terms: [] });
  });

  it('sends no pauses when a later piece has no lead, rather than read half a seam', () => {
    const finished = new FinishedSegments();
    finished.record(socket, 'a', segment('cuộc thử nghiệm', [0, 0, 90], 0));
    finished.record(socket, 'b', segment('trong một bài', [0, 0, 400]));

    expect(finished.block(socket, ['a', 'b'])?.restore).toEqual({ terms: [] });
  });
});
