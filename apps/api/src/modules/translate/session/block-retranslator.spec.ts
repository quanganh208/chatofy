import type { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { LanguageCode, ServerEvent } from '@chatofy/types';
import {
  BlockRetranslator,
  MAX_WAITING_BLOCKS,
  SEAM_READ_BUDGET_MS,
} from './block-retranslator';
import { FinishedSegments, type BlockSeam } from './finished-segments';
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
    const { socket, retranslator, translateAll, release } = harness(
      MAX_WAITING_BLOCKS + 4,
    );

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
    const { socket, retranslator, release } = harness(MAX_WAITING_BLOCKS + 4);

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

/**
 * The block's display: restored as one text beside the translation, finished
 * once the translation is in, and absent whenever the restore did not answer.
 */
describe('BlockRetranslator seam repair', () => {
  const edges = {
    sampleRate: 16000,
    head: Buffer.from([1, 0]),
    tail: Buffer.from([2, 0]),
  };

  const repairHarness = (
    readSeam: (seam: BlockSeam) => Promise<string>,
    recognition: LanguageCode = 'en',
    gone: { now: boolean } = { now: false },
  ) => {
    const socket = new FakeSocket();
    const finished = new FinishedSegments();
    ['Exactly.', 'crucial because it matters.'].forEach((sourceText, i) =>
      finished.record(socket, `s${i}`, {
        sourceText,
        recognition,
        targets: ['vi'],
        seamEdges: edges,
      }),
    );
    const translateAll = vi.fn(
      async ({ text }: { text: string }): Promise<TranslationMap> => ({
        vi: `<${text}>`,
      }),
    );
    const logger = { debug: vi.fn(), warn: vi.fn(), log: vi.fn() };
    const retranslator = new BlockRetranslator(
      finished,
      { translateAll },
      logger as unknown as Logger,
      () => gone.now,
      undefined,
      null,
      readSeam,
    );
    return { socket, retranslator, translateAll, logger, finished };
  };

  it('translates the words the cut lost', async () => {
    const readSeam = vi.fn(
      async () => 'Exactly, and this is crucial because it matters.',
    );
    const { socket, retranslator, translateAll, logger } =
      repairHarness(readSeam);

    await retranslator.retranslate(socket, ['s0', 's1']);

    expect(readSeam).toHaveBeenCalledWith(
      expect.objectContaining({
        leftId: 's0',
        rightId: 's1',
        clip: Buffer.from([2, 0, 1, 0]),
      }),
    );
    expect(translateAll).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Exactly and this is crucial because it matters.',
      }),
    );
    expect(logger.log).toHaveBeenCalledWith('seam repair: read=1 inserted=1');
  });

  it('answers the block as it was when the sidecar fails', async () => {
    const { socket, retranslator, translateAll } = repairHarness(async () => {
      throw new Error('503');
    });

    await retranslator.retranslate(socket, ['s0', 's1']);

    expect(translateAll).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Exactly crucial because it matters.' }),
    );
    expect(socket.answers).toHaveLength(1);
  });

  it('reads a cut once as its block grows, keeping what it found', async () => {
    const readSeam = vi.fn(
      async () => 'Exactly, and this is crucial because it matters.',
    );
    const { socket, retranslator, translateAll, finished } =
      repairHarness(readSeam);
    finished.record(socket, 's2', {
      sourceText: 'It really does.',
      recognition: 'en',
      targets: ['vi'],
    });

    await retranslator.retranslate(socket, ['s0', 's1']);
    await retranslator.retranslate(socket, ['s0', 's1', 's2']);

    expect(readSeam).toHaveBeenCalledTimes(1);
    expect(translateAll).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: 'Exactly and this is crucial because it matters. It really does.',
      }),
    );
  });

  it('reads the cut again after a failure', async () => {
    const readSeam = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValue('Exactly, and this is crucial because it matters.');
    const { socket, retranslator, translateAll } = repairHarness(readSeam);

    await retranslator.retranslate(socket, ['s0', 's1']);
    await retranslator.retranslate(socket, ['s0', 's1']);

    expect(translateAll).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: 'Exactly and this is crucial because it matters.',
      }),
    );
  });

  it('reads one cut at a time', async () => {
    let running = 0;
    let most = 0;
    const readSeam = vi.fn(async () => {
      running += 1;
      most = Math.max(most, running);
      await Promise.resolve();
      running -= 1;
      return '';
    });
    const { socket, retranslator, finished } = repairHarness(readSeam);
    finished.record(socket, 's2', {
      sourceText: 'It really does.',
      recognition: 'en',
      targets: ['vi'],
      seamEdges: edges,
    });

    await retranslator.retranslate(socket, ['s0', 's1', 's2']);

    expect(readSeam).toHaveBeenCalledTimes(2);
    expect(most).toBe(1);
  });

  it('translates without a read that outlives its budget', async () => {
    vi.useFakeTimers();
    try {
      const { socket, retranslator, translateAll } = repairHarness(
        () => new Promise(() => {}),
      );

      const running = retranslator.retranslate(socket, ['s0', 's1']);
      await vi.advanceTimersByTimeAsync(SEAM_READ_BUDGET_MS);
      await running;

      expect(translateAll).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Exactly crucial because it matters.',
        }),
      );
      expect(socket.answers).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('spends no model call once the client has gone during a read', async () => {
    const gone = { now: false };
    const { socket, retranslator, translateAll } = repairHarness(
      async () => {
        gone.now = true;
        return 'Exactly, and this is crucial because it matters.';
      },
      'en',
      gone,
    );

    await retranslator.retranslate(socket, ['s0', 's1']);

    expect(translateAll).not.toHaveBeenCalled();
    expect(socket.answers).toEqual([]);
  });

  it('answers unrepaired when the segments aged out during the read', async () => {
    const { socket, retranslator, translateAll, finished } = repairHarness(
      async () => {
        for (let i = 0; i < 24; i += 1) {
          finished.record(socket, `later${i}`, {
            sourceText: 'x',
            recognition: 'en',
            targets: ['vi'],
          });
        }
        return 'Exactly, and this is crucial because it matters.';
      },
    );

    await retranslator.retranslate(socket, ['s0', 's1']);

    expect(translateAll).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Exactly crucial because it matters.' }),
    );
  });

  it('decodes nothing for a language it was not measured on', async () => {
    const readSeam = vi.fn(async () => '');
    const { socket, retranslator } = repairHarness(readSeam, 'zh');

    await retranslator.retranslate(socket, ['s0', 's1']);

    expect(readSeam).not.toHaveBeenCalled();
  });

  it('decodes nothing for a block the budget refused', async () => {
    const readSeam = vi.fn(async () => '');
    const { socket, retranslator } = repairHarness(readSeam);

    await retranslator.retranslate(socket, ['s0', 'unknown']);

    expect(readSeam).not.toHaveBeenCalled();
    expect(socket.answers[0]?.translations).toEqual({});
  });
});

describe('BlockRetranslator display', () => {
  const displayHarness = (opts: {
    asksDisplay: boolean;
    restored?: string;
    translate?: () => Promise<TranslationMap>;
  }) => {
    const socket = new FakeSocket();
    const finished = new FinishedSegments();
    ['một tác nhân ai của openai', 'đã hoạt động'].forEach((sourceText, i) =>
      finished.record(socket, `s${i}`, {
        sourceText,
        recognition: 'vi',
        targets: ['en'],
        ...(opts.asksDisplay ? { restore: { terms: [] } } : {}),
      }),
    );
    const restore = vi.fn(async () => opts.restored);
    const typeset = vi.fn(
      (_block, restored: string | undefined, translations: TranslationMap) =>
        restored === undefined ? undefined : `${restored} | ${translations.en}`,
    );
    const retranslator = new BlockRetranslator(
      finished,
      {
        translateAll:
          opts.translate ?? (async () => ({ en: 'an OpenAI agent acted' })),
      },
      silentLogger(),
      () => false,
      { restore, typeset },
    );
    return { socket, retranslator, restore, typeset };
  };

  it('sends the block typeset as one text, with the translation it was finished against', async () => {
    const { socket, retranslator, restore } = displayHarness({
      asksDisplay: true,
      restored: 'Một tác nhân AI của Openai đã hoạt động.',
    });

    await retranslator.retranslate(socket, ['s0', 's1']);

    expect(restore).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceText: 'một tác nhân ai của openai đã hoạt động',
      }),
    );
    expect(socket.answers).toEqual([
      {
        type: 'server.block.translated',
        segmentIds: ['s0', 's1'],
        translations: { en: 'an OpenAI agent acted' },
        display:
          'Một tác nhân AI của Openai đã hoạt động. | an OpenAI agent acted',
      },
    ]);
  });

  it('sends no display when the restore did not answer', async () => {
    const { socket, retranslator } = displayHarness({ asksDisplay: true });

    await retranslator.retranslate(socket, ['s0', 's1']);

    expect(socket.answers[0]).not.toHaveProperty('display');
    expect(socket.answers[0]?.translations).toEqual({
      en: 'an OpenAI agent acted',
    });
  });

  it('sends no display for a failed translation, whatever the restore said', async () => {
    const { socket, retranslator, typeset } = displayHarness({
      asksDisplay: true,
      restored: 'Một tác nhân AI.',
      translate: () => Promise.reject(new Error('upstream down')),
    });

    await retranslator.retranslate(socket, ['s0', 's1']);

    expect(socket.answers).toEqual([
      {
        type: 'server.block.translated',
        segmentIds: ['s0', 's1'],
        translations: {},
      },
    ]);
    expect(typeset).not.toHaveBeenCalled();
  });

  describe('polish', () => {
    /** Six finished pieces, a display, and a polisher the test controls. */
    function polished(
      polish: (req: { context?: string[] }) => Promise<string | null>,
      targets: LanguageCode[] = ['vi'],
    ) {
      const socket = new FakeSocket();
      const finished = new FinishedSegments();
      for (let i = 0; i < 6; i += 1) {
        finished.record(socket, `s${i}`, {
          sourceText: `piece ${i}`,
          recognition: 'en',
          targets,
        });
      }
      const gone = new Set<StreamSocket>();
      const polisher = { name: 'fake', polish: vi.fn(polish) };
      const retranslator = new BlockRetranslator(
        finished,
        {
          translateAll: async () =>
            Object.fromEntries(targets.map((t) => [t, 'draft'])),
        },
        silentLogger(),
        (s) => gone.has(s),
        {
          restore: async () => 'Piece 4 piece 5.',
          typeset: (_block, restored, translations) =>
            `${restored} / ${translations.vi}`,
        },
        polisher,
      );
      return { socket, retranslator, polisher, gone };
    }
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    it('answers the draft, then the polish with its display typeset again', async () => {
      const { socket, retranslator, polisher } = polished(
        async () => 'POLISHED',
      );

      await retranslator.retranslate(socket, ['s4', 's5']);
      await settle();

      expect(socket.answers).toHaveLength(2);
      expect(socket.answers[0]).toMatchObject({
        translations: { vi: 'draft' },
        display: 'Piece 4 piece 5. / draft',
      });
      // From the polished text: the draft's display would undo the polish.
      expect(socket.answers[1]).toMatchObject({
        segmentIds: ['s4', 's5'],
        translations: { vi: 'POLISHED' },
        display: 'Piece 4 piece 5. / POLISHED',
      });
      // The speech before the block, never the block's own pieces.
      expect(polisher.polish.mock.calls[0]?.[0].context).toEqual([
        'piece 0',
        'piece 1',
        'piece 2',
        'piece 3',
      ]);
    });

    it('answers once when the polish keeps the draft', async () => {
      const { socket, retranslator } = polished(async () => null);

      await retranslator.retranslate(socket, ['s4', 's5']);
      await settle();

      expect(socket.answers).toHaveLength(1);
    });

    it('answers once when the polish fails', async () => {
      const { socket, retranslator } = polished(() =>
        Promise.reject(new Error('host down')),
      );

      await retranslator.retranslate(socket, ['s4', 's5']);
      await settle();

      expect(socket.answers).toHaveLength(1);
      expect(socket.answers[0]?.translations).toEqual({ vi: 'draft' });
    });

    it('sends nothing more to a client that left before the polish landed', async () => {
      let land!: (text: string) => void;
      const { socket, retranslator, gone } = polished(
        () => new Promise((resolve) => (land = resolve)),
      );

      await retranslator.retranslate(socket, ['s4', 's5']);
      gone.add(socket);
      land('POLISHED');
      await settle();

      expect(socket.answers).toHaveLength(1);
    });

    it('stops polishing once its own budget is spent, without refusing blocks', async () => {
      // Two targets spend two polishes per block, so the polish budget (12 a
      // minute) runs out at block six while the blocks' own (also 12) does not:
      // one shared bucket would refuse blocks from the fifth on.
      const { socket, retranslator, polisher } = polished(
        async () => 'POLISHED',
        ['vi', 'zh'],
      );

      for (let i = 0; i < 12; i += 1) {
        await retranslator.retranslate(socket, ['s4', 's5'], 'user-1');
        await settle();
      }

      expect(polisher.polish).toHaveBeenCalledTimes(12);
      const drafts = socket.answers.filter(
        (a) => a.translations.vi === 'draft',
      );
      const polishes = socket.answers.filter(
        (a) => a.translations.vi === 'POLISHED',
      );
      expect(drafts).toHaveLength(12);
      expect(polishes).toHaveLength(6);
    });
  });
});
