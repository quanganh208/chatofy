import { Logger } from '@nestjs/common';
import type { ServerEvent } from '@chatofy/types';
import { EventChannel } from './event-channel';
import type { StreamSocket } from './stream-socket';

class FakeSocket implements StreamSocket {
  readonly sent: ServerEvent[] = [];
  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerEvent);
  }
}

/** A logger whose `warn` is kept to hand, so tests never unbind a method. */
const silentLogger = () => {
  const warn = jest.fn();
  return { logger: { warn } as unknown as Logger, warn };
};

describe('EventChannel', () => {
  it('serializes each event onto the socket', () => {
    const socket = new FakeSocket();
    new EventChannel(socket, silentLogger().logger).emit({
      type: 'server.session.ready',
      sessionId: 'abc',
    });

    expect(socket.sent).toEqual([
      { type: 'server.session.ready', sessionId: 'abc' },
    ]);
  });

  it('sends errors and endings in the shape the contract names', () => {
    const socket = new FakeSocket();
    const channel = new EventChannel(socket, silentLogger().logger);

    channel.fail('no_audio', 'The turn carried no audio');
    channel.ended('completed');

    expect(socket.sent).toEqual([
      {
        type: 'server.error',
        code: 'no_audio',
        message: 'The turn carried no audio',
      },
      { type: 'server.session.ended', reason: 'completed' },
    ]);
  });

  // `ws` reports a send after close as an error when no callback is given, and
  // an unhandled one would take the process down for a client that already
  // left. The turn must not learn about it.
  it('swallows a send that fails, and says so in the log', () => {
    const { logger, warn } = silentLogger();
    const dead: StreamSocket = {
      send() {
        throw new Error('WebSocket is not open');
      },
    };

    expect(() =>
      new EventChannel(dead, logger).emit({
        type: 'server.session.ended',
        reason: 'completed',
      }),
    ).not.toThrow();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('server.session.ended'),
    );
  });

  it('keeps sending after one event was dropped', () => {
    const { logger, warn } = silentLogger();
    let failNext = true;
    const flaky: StreamSocket = {
      send() {
        if (failNext) {
          failNext = false;
          throw new Error('WebSocket is not open');
        }
      },
    };
    const channel = new EventChannel(flaky, logger);

    channel.fail('turn_failed', 'Translation failed');
    channel.ended('error');

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
