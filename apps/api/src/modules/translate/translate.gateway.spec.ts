import { WsException } from '@nestjs/websockets';
import type { AuthAdapter } from '../auth/interfaces/auth-adapter.interface';
import { SessionTerminator } from '../auth/session-terminator';
import { VERIFIED_USER_ID } from './ws-auth';
import { TranslateGateway } from './translate.gateway';
import type {
  StreamSocket,
  TranslationSessionService,
} from './services/translation-session.service';
import type { LiveTranslateSessionService } from './services/live-translate-session.service';
import type { GlossaryService } from '../glossary/glossary.service';

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
  let auth: jest.Mocked<AuthAdapter>;
  let glossary: jest.Mocked<Pick<GlossaryService, 'list'>>;
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
    // A mock verifier as an ordinary constructor argument, matching this
    // file's existing style. The upgrade check itself is covered directly in
    // ws-auth.spec.ts, which needs no gateway at all.
    auth = {
      verifyToken: jest.fn().mockResolvedValue({ sub: 'user_1' }),
      getUser: jest.fn(),
      issueToken: jest.fn(),
    };
    glossary = { list: jest.fn().mockResolvedValue([]) };
    // A real SessionTerminator rather than a mock: it is a plain in-memory
    // registry with no dependencies, and the gateway registering itself with it
    // is part of what these tests exercise.
    gateway = new TranslateGateway(
      sessions as unknown as TranslationSessionService,
      live as unknown as LiveTranslateSessionService,
      auth,
      new SessionTerminator(),
      glossary as unknown as GlossaryService,
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
        undefined,
      );
    });

    it('forwards every option the contract carries, including the opt-in flags', () => {
      // This is the regression the previous shape allowed. The gateway named
      // each option and rebuilt the object, so `embedSpeaker` and
      // `repairDisplay` — both optional, both parsed correctly here — were
      // dropped on the floor between the wire and `TurnSession`. Speaker
      // embedding and display repair were dead in production with every other
      // layer correct: the client asked, the schema accepted, the service
      // checked a flag that was never set, and nothing logged because the
      // feature returned before its first log line.
      //
      // Asserting the WHOLE object rather than the two flags is deliberate. A
      // test that named them would have to be edited for the next field too,
      // which is the same failure one layer up.
      gateway.handleSessionStart(
        {
          type: 'client.session.start',
          direction: 'vi_to_en',
          voiceGender: 'male',
          embedSpeaker: true,
          repairDisplay: true,
          turnId: 'turn-1',
        },
        socket,
      );
      expect(sessions.start).toHaveBeenCalledWith(
        socket,
        {
          direction: 'vi_to_en',
          voiceGender: 'male',
          embedSpeaker: true,
          repairDisplay: true,
        },
        'turn-1',
        undefined,
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
        undefined,
      );
    });

    it('carries voice output and speed when the client sends them', () => {
      gateway.handleSessionStart(
        {
          type: 'client.session.start',
          direction: 'vi_to_en',
          voiceOutput: false,
          speed: 1.5,
        },
        socket,
      );
      expect(sessions.start).toHaveBeenCalledWith(
        socket,
        expect.objectContaining({ voiceOutput: false, speed: 1.5 }),
        undefined,
        undefined,
      );
    });

    it('CLAMPS a speed outside the accepted range instead of refusing the turn', () => {
      // The distinction this asserts is the whole reason the field is written the
      // way it is. A rejected `client.session.start` throws a WsException, which
      // AllExceptionsFilter swallows — so the client is answered with silence and
      // sits in "connecting" forever, with clearing its own storage the only way
      // out. A clamped value starts the conversation.
      gateway.handleSessionStart(
        { type: 'client.session.start', direction: 'vi_to_en', speed: 99 },
        socket,
      );
      expect(sessions.start).toHaveBeenCalledWith(
        socket,
        expect.objectContaining({ speed: 2 }),
        undefined,
        undefined,
      );
    });

    it('starts a turn for a client that sends neither new field', () => {
      // web and api do not deploy together, so a tab loaded before this change is
      // still sending the old shape and must keep working unchanged.
      gateway.handleSessionStart(
        { type: 'client.session.start', direction: 'en_to_vi' },
        socket,
      );
      expect(sessions.start).toHaveBeenCalledWith(
        socket,
        expect.objectContaining({
          direction: 'en_to_vi',
          voiceGender: 'female',
        }),
        undefined,
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

  it('installs the upgrade check on the server the adapter built', () => {
    // Set in afterInit rather than through @WebSocketGateway's options, because
    // decorator arguments run at class-definition time — before a DI container
    // exists to resolve the verifier from.
    const server = { options: {} as Record<string, unknown> };
    gateway.afterInit(server);
    expect(typeof server.options.verifyClient).toBe('function');
    expect(typeof server.options.handleProtocols).toBe('function');
  });

  /**
   * The transport half of revocation: a completed password reset closes that
   * user's open sockets.
   *
   * Without it, revocation stops at the upgrade — the guard returns true for
   * every non-HTTP context, no frame re-authenticates, and a socket has no
   * maximum lifetime, so a stolen token would keep streaming audio and
   * transcripts straight through the reset performed to stop it.
   */
  describe('socket registry', () => {
    /** A socket plus the upgrade request `ws` hands alongside it. */
    function connected(userId?: string) {
      const client = { send: jest.fn(), close: jest.fn() };
      const req: Record<string | symbol, unknown> = { headers: {} };
      if (userId !== undefined) req[VERIFIED_USER_ID] = userId;
      gateway.handleConnection(client, req);
      return client;
    }

    it("closes a user's open socket when their credentials change", () => {
      const client = connected('user_1');
      expect(gateway.closeSessionsFor('user_1')).toBe(1);
      expect(client.close).toHaveBeenCalledWith(1008, 'Credentials changed');
    });

    it('leaves other users connected', () => {
      const mine = connected('user_1');
      const theirs = connected('user_2');
      gateway.closeSessionsFor('user_1');
      expect(mine.close).toHaveBeenCalled();
      expect(theirs.close).not.toHaveBeenCalled();
    });

    it('closes every socket one user holds', () => {
      const first = connected('user_1');
      const second = connected('user_1');
      expect(gateway.closeSessionsFor('user_1')).toBe(2);
      expect(first.close).toHaveBeenCalled();
      expect(second.close).toHaveBeenCalled();
    });

    it('has nothing to close for a user with no sockets', () => {
      expect(gateway.closeSessionsFor('nobody')).toBe(0);
    });

    it('forgets a socket once it disconnects', () => {
      const client = connected('user_1');
      gateway.handleDisconnect(client);
      expect(gateway.closeSessionsFor('user_1')).toBe(0);
      expect(client.close).not.toHaveBeenCalled();
    });

    it('does not register a socket that carries no verified subject', () => {
      // Only reachable if an upgrade bypassed verification. Inventing an owner
      // for it would be worse than declining to close it later.
      const client = connected(undefined);
      expect(gateway.closeSessionsFor('user_1')).toBe(0);
      expect(client.close).not.toHaveBeenCalled();
    });

    it('is reachable through the terminator the gateway registered with', () => {
      // The wiring, not just the method: auth calls `terminate`, and nothing in
      // auth names a gateway or a socket.
      const terminator = new SessionTerminator();
      const own = new TranslateGateway(
        sessions as unknown as TranslationSessionService,
        live as unknown as LiveTranslateSessionService,
        auth,
        terminator,
        glossary as unknown as GlossaryService,
      );
      const client = { send: jest.fn(), close: jest.fn() };
      own.handleConnection(client, {
        headers: {},
        [VERIFIED_USER_ID]: 'user_1',
      });
      expect(terminator.terminate('user_1')).toBe(1);
      expect(client.close).toHaveBeenCalled();
    });
  });
});
