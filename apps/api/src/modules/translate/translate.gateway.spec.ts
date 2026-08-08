import { WsException } from '@nestjs/websockets';
import { TranslateGateway } from './translate.gateway';
import type {
  StreamSocket,
  TranslationSessionService,
} from './services/translation-session.service';
import type { LiveTranslateSessionService } from './services/live-translate-session.service';

describe('TranslateGateway', () => {
  let sessions: jest.Mocked<
    Pick<
      TranslationSessionService,
      'start' | 'pushFrame' | 'speculate' | 'end' | 'disconnect'
    >
  >;
  let live: jest.Mocked<
    Pick<LiveTranslateSessionService, 'start' | 'pushFrame' | 'stop'>
  >;
  let gateway: TranslateGateway;
  const socket: StreamSocket = { send: jest.fn() };

  beforeEach(() => {
    sessions = {
      start: jest.fn(),
      pushFrame: jest.fn(),
      speculate: jest.fn(),
      end: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
    };
    live = {
      start: jest.fn().mockResolvedValue(undefined),
      pushFrame: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    gateway = new TranslateGateway(
      sessions as unknown as TranslationSessionService,
      live as unknown as LiveTranslateSessionService,
    );
    // The socket is shared across tests while the gateway is not, so without
    // this a `toContainEqual` on sent events could be satisfied by an event the
    // PREVIOUS test emitted.
    (socket.send as jest.Mock).mockClear();
  });

  const validFrame = {
    sessionId: 's1',
    encoding: 'pcm16',
    sampleRate: 16000,
    sequence: 0,
    timestamp: 0,
    payload: 'AAAA',
  };

  // The gateway is transport only: its whole job is to reject anything the
  // shared contract does not describe, then hand the rest to the state machine.
  describe('delegation', () => {
    it('passes valid session.start options to the session service', () => {
      gateway.handleSessionStart(
        {
          type: 'client.session.start',
          direction: 'vi_to_en',
          voiceGender: 'male',
          turnId: 'turn-1',
        },
        socket,
      );
      // The turn id travels as a third argument, not folded into the options:
      // it names the turn rather than configuring the translation, and
      // `sessionOptionsSchema` is rebuilt here so widening it would pull the id
      // through every layer that touches that object.
      expect(sessions.start).toHaveBeenCalledWith(
        socket,
        { direction: 'vi_to_en', voiceGender: 'male' },
        'turn-1',
      );
    });

    it('defaults the voice for a start that names no gender', () => {
      // The field is optional on the wire so an older client keeps working; by
      // the time it reaches the state machine it must already be decided.
      gateway.handleSessionStart(
        { type: 'client.session.start', direction: 'vi_to_en' },
        socket,
      );
      // `turnId` is optional for the same reason and stays undefined here: the
      // two apps do not deploy atomically, so a tab loaded before this change is
      // still sending the old shape and must keep working.
      expect(sessions.start).toHaveBeenCalledWith(
        socket,
        { direction: 'vi_to_en', voiceGender: 'female' },
        undefined,
      );
    });

    it('passes a valid audio.frame to the session service', () => {
      gateway.handleAudioFrame(
        { type: 'client.audio.frame', frame: validFrame },
        socket,
      );
      expect(sessions.pushFrame).toHaveBeenCalledWith(socket, validFrame);
    });

    it('passes a suspected end of speech to the session service', () => {
      gateway.handleTurnSpeculate(
        { type: 'client.turn.speculate', sessionId: 's1' },
        socket,
      );
      expect(sessions.speculate).toHaveBeenCalledWith(socket, 's1');
    });

    it('awaits the turn on session.end', async () => {
      await gateway.handleSessionEnd(
        { type: 'client.session.end', sessionId: 's1' },
        socket,
      );
      expect(sessions.end).toHaveBeenCalledWith(socket, 's1');
    });

    // The id is optional on the wire so a tab loaded before the field existed
    // keeps working. The service then falls back to the socket's only turn.
    it('passes no id when the client sent none', async () => {
      gateway.handleTurnSpeculate({ type: 'client.turn.speculate' }, socket);
      await gateway.handleSessionEnd({ type: 'client.session.end' }, socket);

      expect(sessions.speculate).toHaveBeenCalledWith(socket, undefined);
      expect(sessions.end).toHaveBeenCalledWith(socket, undefined);
    });

    it('releases the turn when the socket drops', () => {
      gateway.handleDisconnect(socket);
      expect(sessions.disconnect).toHaveBeenCalledWith(socket);
    });
  });

  /**
   * One path, two message families. These rules are what keeps that from
   * becoming a way for a connection to hold both at once — and three of them
   * are the ones a naive `if (claimed) reject` gets wrong.
   */
  describe('connection mode', () => {
    const startTurn = () =>
      gateway.handleSessionStart(
        { type: 'client.session.start', direction: 'vi_to_en' },
        socket,
      );
    const startLive = () =>
      gateway.handleLiveStart(
        { type: 'client.live.start', direction: 'vi_to_en' },
        socket,
      );

    /** The refusal the client can actually read, for the family it speaks. */
    const sentEvents = (): { type: string; code?: string }[] => {
      const calls = (socket.send as jest.Mock<void, [string]>).mock.calls;
      return calls.map(
        ([body]) => JSON.parse(body) as { type: string; code?: string },
      );
    };

    // Emitted, never thrown. A WsException from a gateway handler reaches this
    // client as silence — measured against a real socket in the e2e — and a
    // silent refusal is indistinguishable from a hung session.
    it('refuses a live start on a connection already serving turns', async () => {
      startTurn();
      await startLive();

      expect(live.start).not.toHaveBeenCalled();
      expect(sentEvents()).toContainEqual(
        expect.objectContaining({
          type: 'server.live.error',
          code: 'mode_conflict',
        }),
      );
    });

    it('refuses a turn start on a connection already serving live', async () => {
      await startLive();
      startTurn();

      expect(sessions.start).not.toHaveBeenCalled();
      expect(sentEvents()).toContainEqual(
        expect.objectContaining({
          type: 'server.error',
          code: 'mode_conflict',
        }),
      );
    });

    // A socket may hold several turns at once, which is exactly what the
    // extension does. "Same family passes" is the rule, not "first start only".
    it('allows a second turn start on the same connection', () => {
      startTurn();
      expect(() => startTurn()).not.toThrow();
      expect(sessions.start).toHaveBeenCalledTimes(2);
    });

    // The claim lets it through; the live service's own one-session-per-
    // connection rule reports it, so a second guard here would only duplicate
    // an error that already reads properly.
    it('lets a second live start reach the service that reports it', async () => {
      await startLive();
      await expect(startLive()).resolves.toBeUndefined();
      expect(live.start).toHaveBeenCalledTimes(2);
    });

    // Rule 1, pinned. The guard is on STARTS only: adding it to the frame
    // handlers would put a WeakMap lookup on the audio hot path this project
    // measures, and the owning service already answers a stray frame properly.
    // Nothing else fails if a later refactor "tidies" the guard onto all eight
    // handlers, which is exactly why this test exists.
    it('does not guard frames, only starts', async () => {
      startTurn();
      await gateway.handleLiveAudio(
        { type: 'client.live.audio', frame: validFrame },
        socket,
      );
      expect(live.pushFrame).toHaveBeenCalledWith(socket, validFrame);
    });

    // Both, unconditionally. Skipping the live half fails nothing and logs
    // nothing — it just leaves the upstream socket metered until the idle sweep.
    it('frees both a turn and a live session when the socket drops', () => {
      gateway.handleDisconnect(socket);
      expect(sessions.disconnect).toHaveBeenCalledWith(socket);
      expect(live.stop).toHaveBeenCalledWith(socket, 'disconnected');
    });
  });

  describe('contract validation', () => {
    it('rejects a payload missing required fields', () => {
      expect(() =>
        gateway.handleSessionStart({ type: 'client.session.start' }, socket),
      ).toThrow(WsException);
      expect(sessions.start).not.toHaveBeenCalled();
    });

    it('rejects the legacy pre-contract payload shape', () => {
      expect(() =>
        gateway.handleSessionStart(
          { sessionId: 's1', sourceLang: 'vi', targetLang: 'en' },
          socket,
        ),
      ).toThrow(WsException);
      expect(sessions.start).not.toHaveBeenCalled();
    });

    it('rejects an event whose type does not match the subscribed handler', () => {
      expect(() =>
        gateway.handleAudioFrame({ type: 'client.session.end' }, socket),
      ).toThrow(WsException);
      expect(sessions.pushFrame).not.toHaveBeenCalled();
    });
  });
});
