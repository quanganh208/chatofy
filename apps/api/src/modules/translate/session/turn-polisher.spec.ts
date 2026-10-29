import type { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type {
  TranslationPolishRequest,
  TranslationPolisher,
} from '@chatofy/ai-providers';
import type { ServerEvent } from '@chatofy/types';
import { EventChannel } from './event-channel';
import type { StreamSocket } from './stream-socket';
import { TurnPolisher, type TurnPolishInput } from './turn-polisher';

/**
 * The second pass is invisible unless it changed something, and never an
 * error: every failure here must end with the draft standing and no event.
 */

class FakeSocket implements StreamSocket {
  readonly sent: ServerEvent[] = [];
  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerEvent);
  }
}

const logger = () => ({ debug: vi.fn(), warn: vi.fn() }) as unknown as Logger;

const input = (over: Partial<TurnPolishInput> = {}): TurnPolishInput => ({
  userId: 'u1',
  sessionId: 's1',
  sourceText: 'trời mưa to',
  source: 'vi',
  translations: { en: 'rain big', zh: '雨大' },
  ...over,
});

function polisherAnswering(answers: Record<string, string | null | Error>) {
  return {
    name: 'fake',
    polish: vi.fn(async ({ targetLanguage }: TranslationPolishRequest) => {
      const answer = answers[targetLanguage];
      if (answer instanceof Error) throw answer;
      return answer ?? null;
    }),
  } satisfies TranslationPolisher;
}

/** Runs one polish and lets every promise it started settle. */
async function run(
  polisher: TranslationPolisher | null,
  gone = false,
  over?: Partial<TurnPolishInput>,
) {
  const socket = new FakeSocket();
  const log = logger();
  const turnPolisher = new TurnPolisher(polisher, log, () => gone);
  turnPolisher.polish(socket, new EventChannel(socket, log), input(over));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return socket.sent;
}

describe('TurnPolisher', () => {
  it('does nothing on a host without a polisher', async () => {
    await expect(run(null)).resolves.toEqual([]);
  });

  it('sends nothing when every draft stood', async () => {
    await expect(
      run(polisherAnswering({ en: null, zh: null })),
    ).resolves.toEqual([]);
  });

  it('sends the merged map when one target of two changed', async () => {
    await expect(
      run(polisherAnswering({ en: 'It is raining hard.', zh: null })),
    ).resolves.toEqual([
      {
        type: 'server.translation.polished',
        sessionId: 's1',
        translations: { en: 'It is raining hard.', zh: '雨大' },
      },
    ]);
  });

  it('keeps what it got when one target fails', async () => {
    const sent = await run(
      polisherAnswering({ en: new Error('timeout'), zh: '雨下得很大。' }),
    );
    expect(sent).toEqual([
      {
        type: 'server.translation.polished',
        sessionId: 's1',
        translations: { en: 'rain big', zh: '雨下得很大。' },
      },
    ]);
  });

  it('swallows a failure of every target', async () => {
    await expect(
      run(polisherAnswering({ en: new Error('429'), zh: new Error('429') })),
    ).resolves.toEqual([]);
  });

  it('sends nothing to a socket that has gone', async () => {
    await expect(
      run(polisherAnswering({ en: 'better' }), true),
    ).resolves.toEqual([]);
  });

  it('skips empty drafts', async () => {
    const polisher = polisherAnswering({ en: 'better' });
    await run(polisher, false, { translations: { en: 'x', zh: '  ' } });
    expect(polisher.polish).toHaveBeenCalledTimes(1);
  });

  it('stops asking once the per-user budget is spent', async () => {
    const polisher = polisherAnswering({ en: 'better' });
    const socket = new FakeSocket();
    const log = logger();
    const turnPolisher = new TurnPolisher(polisher, log, () => false);
    for (let i = 0; i < 25; i += 1) {
      turnPolisher.polish(
        socket,
        new EventChannel(socket, log),
        input({ translations: { en: 'x' } }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(polisher.polish).toHaveBeenCalledTimes(20);
  });
});
