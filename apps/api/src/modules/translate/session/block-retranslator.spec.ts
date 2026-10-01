import type { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ServerEvent } from '@chatofy/types';
import { BlockRetranslator, MAX_WAITING_BLOCKS } from './block-retranslator';
import { FinishedSegments } from './finished-segments';
import type { StreamSocket } from './stream-socket';
import type { TranslationMap } from './turn-language-plan';

/**
 * The queue behind a running block retranslation, apart from any turn.
 *
 * What these pin is the contract the client's drain depends on: every block a
 * connection asks for is answered — a refusal with empty `translations` — so a
 * client never waits out its grace period for a block nobody will answer, and
 * the queue a client can grow stays bounded whatever it sends.
 */

type BlockAnswer = Extract<ServerEvent, { type: 'server.block.translated' }>;

class FakeSocket implements StreamSocket {
  readonly answers: BlockAnswer[] = [];
  send(data: string): void {
    this.answers.push(JSON.parse(data) as BlockAnswer);
  }
}

const silentLogger = (): Logger =>
  ({ debug: vi.fn(), warn: vi.fn() }) as unknown as Logger;

/** A retranslator over a socket that finished segments `s0`…`s{count-1}`. */
function harness(count = 6) {
  const socket = new FakeSocket();
  const finished = new FinishedSegments();
  for (let i = 0; i < count; i += 1) {
    finished.record(socket, `s${i}`, {
      sourceText: `piece ${i}`,
      recognition: 'vi',
      targets: ['en'],
    });
  }
  let release!: () => void;
  const translateAll = vi.fn(
    async ({ text }: { text: string }): Promise<TranslationMap> => ({
      en: `<${text}>`,
    }),
  );
  // The first call hangs until released, so everything after it queues.
  translateAll.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ en: 'first' });
      }),
  );
  const gone = new Set<StreamSocket>();
  const retranslator = new BlockRetranslator(
    finished,
    { translateAll },
    silentLogger(),
    (s) => gone.has(s),
  );
  return {
    socket,
    translateAll,
    retranslator,
    gone,
    release: () => release(),
  };
}

const idsOf = (socket: FakeSocket) => socket.answers.map((a) => a.segmentIds);

describe('BlockRetranslator', () => {
  it('answers every request when a waiting block keeps growing', async () => {
    const { socket, retranslator, translateAll, release } = harness();

    const running = retranslator.retranslate(socket, ['s0', 's1']);
    void retranslator.retranslate(socket, ['s0', 's1', 's2']);
    void retranslator.retranslate(socket, ['s0', 's1', 's2', 's3']);
    // The displaced shape is answered empty at once, while the first block
    // is still being translated.
    expect(socket.answers).toEqual([
      {
        type: 'server.block.translated',
        segmentIds: ['s0', 's1', 's2'],
        translations: {},
      },
    ]);
    release();
    await running;

    expect(socket.answers.map((a) => [a.segmentIds, a.translations])).toEqual([
      [['s0', 's1', 's2'], {}],
      [['s0', 's1'], { en: 'first' }],
      [['s0', 's1', 's2', 's3'], { en: '<piece 0 piece 1 piece 2 piece 3>' }],
    ]);
    expect(translateAll).toHaveBeenCalledTimes(2);
  });

  it('refuses segments this connection did not produce before queueing them', async () => {
    const { socket, retranslator, translateAll, release } = harness();

    const running = retranslator.retranslate(socket, ['s0', 's1']);
    void retranslator.retranslate(socket, ['forged-1', 'forged-2']);
    // Answered now, not after the running block: it never entered the queue.
    expect(socket.answers).toEqual([
      {
        type: 'server.block.translated',
        segmentIds: ['forged-1', 'forged-2'],
        translations: {},
      },
    ]);
    release();
    await running;

    expect(idsOf(socket)).toEqual([
      ['forged-1', 'forged-2'],
      ['s0', 's1'],
    ]);
    expect(translateAll).toHaveBeenCalledTimes(1);
  });

  it('caps the blocks waiting per connection and answers the rest empty', async () => {
    const { socket, retranslator, translateAll, release } = harness(12);

    const running = retranslator.retranslate(socket, ['s0', 's1']);
    const queued = Array.from({ length: MAX_WAITING_BLOCKS + 2 }, (_, i) => [
      `s${i + 1}`,
      `s${i + 2}`,
    ]);
    for (const ids of queued) void retranslator.retranslate(socket, ids);
    // Past the cap, answered empty at once.
    expect(idsOf(socket)).toEqual(queued.slice(MAX_WAITING_BLOCKS));
    expect(
      socket.answers.every((a) => Object.keys(a.translations).length === 0),
    ).toBe(true);
    release();
    await running;

    expect(translateAll).toHaveBeenCalledTimes(1 + MAX_WAITING_BLOCKS);
    // Every request was answered exactly once.
    expect(idsOf(socket)).toHaveLength(1 + queued.length);
  });

  it('still lets a waiting block grow when the queue is full', async () => {
    const { socket, retranslator, release } = harness(12);

    const running = retranslator.retranslate(socket, ['s0', 's1']);
    for (let i = 1; i <= MAX_WAITING_BLOCKS; i += 1) {
      void retranslator.retranslate(socket, [`s${i}`, `s${i + 1}`]);
    }
    // Replaces its own entry, so it takes no new slot.
    void retranslator.retranslate(socket, ['s1', 's2', 's3']);
    expect(socket.answers.map((a) => [a.segmentIds, a.translations])).toEqual([
      [['s1', 's2'], {}],
    ]);
    release();
    await running;

    expect(idsOf(socket)).toContainEqual(['s1', 's2', 's3']);
  });

  it('answers nothing once the client has gone', async () => {
    const { socket, retranslator, gone, translateAll, release } = harness();

    const running = retranslator.retranslate(socket, ['s0', 's1']);
    void retranslator.retranslate(socket, ['s2', 's3']);
    gone.add(socket);
    release();
    await running;

    // The call already running still sends its answer; the queue is dropped
    // rather than spent on a socket with nobody behind it.
    expect(translateAll).toHaveBeenCalledTimes(1);
    expect(idsOf(socket)).toEqual([['s0', 's1']]);
  });
});
