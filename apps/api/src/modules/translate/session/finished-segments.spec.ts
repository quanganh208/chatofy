import { describe, expect, it } from 'vitest';
import type { StreamSocket } from './stream-socket';
import { FinishedSegments, type FinishedSegment } from './finished-segments';

const socket = {} as StreamSocket;
const segment = (sourceText: string, pauses?: number[]): FinishedSegment => ({
  sourceText,
  recognition: 'vi',
  targets: ['en'],
  restore: { terms: [], ...(pauses ? { pauses } : {}) },
});

describe('FinishedSegments block pauses', () => {
  it("joins the pieces' pauses end to end", () => {
    const finished = new FinishedSegments();
    finished.record(socket, 'a', segment('xin chào anh', [0, 0, 10]));
    finished.record(socket, 'b', segment('tuấn anh', [0, 400]));

    expect(finished.block(socket, ['a', 'b'])?.restore).toEqual({
      terms: [],
      pauses: [0, 0, 10, 0, 400],
    });
  });

  it('sends no pauses when any piece has none, rather than misalign them', () => {
    const finished = new FinishedSegments();
    finished.record(socket, 'a', segment('xin chào anh', [0, 0, 10]));
    finished.record(socket, 'b', segment('tuấn anh'));

    expect(finished.block(socket, ['a', 'b'])?.restore).toEqual({ terms: [] });
  });
});
