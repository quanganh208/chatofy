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

/** The turn most tests here talk about, under both of its names. */
const turn = { sessionId: 'abc', turnId: 't1' };

describe('EventChannel', () => {
  it('serializes each event onto the socket', () => {
    const socket = new FakeSocket();
    new EventChannel(socket, silentLogger().logger, turn).emit({
      type: 'server.session.ready',
      sessionId: 'abc',
      turnId: 't1',
    });

    expect(socket.sent).toEqual([
      { type: 'server.session.ready', sessionId: 'abc', turnId: 't1' },
    ]);
  });

  it('sends errors and endings in the shape the contract names', () => {
    const socket = new FakeSocket();
    const channel = new EventChannel(socket, silentLogger().logger, turn);

    channel.fail('no_audio', 'The turn carried no audio');
    channel.ended('completed');

    expect(socket.sent).toEqual([
      {
        type: 'server.error',
        code: 'no_audio',
        message: 'The turn carried no audio',
        sessionId: 'abc',
        turnId: 't1',
      },
      {
        type: 'server.session.ended',
        reason: 'completed',
        sessionId: 'abc',
        turnId: 't1',
      },
    ]);
  });

  // The case the client ceiling produces: a turn refused inside `start()` has no
  // server id yet, so the client's own name is the only thing that can identify
  // it. Without this, a client cannot tell which of several in-flight turns was
  // refused and an ordered playback queue waits on it forever.
  it('names a refused turn by the client id when there is no session id', () => {
    const socket = new FakeSocket();
    new EventChannel(socket, silentLogger().logger, { turnId: 't9' }).fail(
      'too_many_turns',
      'Too many turns are already open',
    );

    expect(socket.sent).toEqual([
      {
        type: 'server.error',
        code: 'too_many_turns',
        message: 'Too many turns are already open',
        turnId: 't9',
      },
    ]);
  });

  // A malformed frame, or a message arriving with no turn open, belongs to the
  // connection. Attaching a turn id to it would be a guess.
  it('omits both ids for a fault that belongs to no turn', () => {
    const socket = new FakeSocket();
    new EventChannel(socket, silentLogger().logger).fail(
      'no_active_session',
      'Send client.session.start first',
    );

    expect(socket.sent).toEqual([
      {
        type: 'server.error',
        code: 'no_active_session',
        message: 'Send client.session.start first',
      },
    ]);
  });

  // `server.session.ended` has no meaning without a session id, and the contract
  // has no shape for one. Reaching this is a wiring mistake, so it is logged
  // rather than silently emitting a turn-less ending the client cannot act on.
  it('refuses to end a turn it cannot name, and says so', () => {
    const { logger, warn } = silentLogger();
    const socket = new FakeSocket();

    new EventChannel(socket, logger, { turnId: 't1' }).ended('completed');

    expect(socket.sent).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('server.session.ended'),
    );
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
      new EventChannel(dead, logger, turn).emit({
        type: 'server.session.ended',
        reason: 'completed',
        sessionId: 'abc',
      }),
    ).not.toThrow();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('server.session.ended'),
    );
  });

  // One dropped event must not become a closed channel: the turn carries on and
  // its later events still have to go out.
  it('keeps sending after one event was dropped', () => {
    const { logger, warn } = silentLogger();
    const delivered: ServerEvent[] = [];
    let failNext = true;
    const flaky: StreamSocket = {
      send(data: string) {
        if (failNext) {
          failNext = false;
          throw new Error('WebSocket is not open');
        }
        delivered.push(JSON.parse(data) as ServerEvent);
      },
    };
    const channel = new EventChannel(flaky, logger, turn);

    channel.fail('turn_failed', 'Translation failed');
    channel.ended('error');

    expect(warn).toHaveBeenCalledTimes(1);
    // The assertion the name promises: the second event actually arrived.
    expect(delivered).toEqual([
      {
        type: 'server.session.ended',
        reason: 'error',
        sessionId: 'abc',
        turnId: 't1',
      },
    ]);
  });
});
