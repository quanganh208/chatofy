import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock, Mocked } from 'vitest';
import { WsException } from '@nestjs/websockets';
import type { AuthAdapter } from '../auth/interfaces/auth-adapter.interface';
import { SessionTerminator } from '../auth/session-terminator';
import { VERIFIED_USER_ID } from './ws-auth';
import { TranslateGateway } from './translate.gateway';
import type {
  StreamSocket,
  TranslationSessionService,
} from './services/translation-session.service';

describe('TranslateGateway', () => {
  let sessions: Mocked<
    Pick<
      TranslationSessionService,
      'start' | 'pushFrame' | 'speculate' | 'end' | 'disconnect'
    >
  >;
  let auth: Mocked<AuthAdapter>;
  let gateway: TranslateGateway;
  const socket: StreamSocket = { send: vi.fn() };

  beforeEach(() => {
    sessions = {
      start: vi.fn(),
      pushFrame: vi.fn(),
      speculate: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    };
    // A mock verifier as an ordinary constructor argument, matching this
    // file's existing style. The upgrade check itself is covered directly in
    // ws-auth.spec.ts, which needs no gateway at all.
    auth = {
      verifyToken: vi.fn().mockResolvedValue({ sub: 'user_1' }),
      getUser: vi.fn(),
      issueToken: vi.fn(),
    };
    // A real SessionTerminator rather than a mock: it is a plain in-memory
    // registry with no dependencies, and the gateway registering itself with it
    // is part of what these tests exercise.
    gateway = new TranslateGateway(
      sessions as unknown as TranslationSessionService,
      auth,
      new SessionTerminator(),
    );
    // The socket is shared across tests while the gateway is not, so without
    // this a `toContainEqual` on sent events could be satisfied by an event the
    // PREVIOUS test emitted.
    (socket.send as Mock).mockClear();
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
          languagePair: { source: 'vi', target: 'en' },
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
        { languagePair: { source: 'vi', target: 'en' }, voiceGender: 'male' },
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
          languagePair: { source: 'vi', target: 'en' },
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
          languagePair: { source: 'vi', target: 'en' },
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
        {
          type: 'client.session.start',
          languagePair: { source: 'vi', target: 'en' },
        },
        socket,
      );
      // `turnId` is optional for the same reason and stays undefined here: the
      // two apps do not deploy atomically, so a tab loaded before this change is
      // still sending the old shape and must keep working.
      expect(sessions.start).toHaveBeenCalledWith(
        socket,
        { languagePair: { source: 'vi', target: 'en' }, voiceGender: 'female' },
        undefined,
        undefined,
      );
    });

    it('carries voice output and speed when the client sends them', () => {
      gateway.handleSessionStart(
        {
          type: 'client.session.start',
          languagePair: { source: 'vi', target: 'en' },
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
        {
          type: 'client.session.start',
          languagePair: { source: 'vi', target: 'en' },
          speed: 99,
        },
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
        {
          type: 'client.session.start',
          languagePair: { source: 'en', target: 'vi' },
        },
        socket,
      );
      expect(sessions.start).toHaveBeenCalledWith(
        socket,
        expect.objectContaining({
          languagePair: { source: 'en', target: 'vi' },
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

  describe('turn starts', () => {
    const client = () => ({ send: vi.fn(), close: vi.fn() });
    const sent = (c: ReturnType<typeof client>) =>
      c.send.mock.calls.map(
        ([body]) => JSON.parse(String(body)) as { type: string; code?: string },
      );

    it('serves a turn start without closing or answering early', () => {
      const c = client();
      gateway.handleSessionStart(
        {
          type: 'client.session.start',
          languagePair: { source: 'vi', target: 'en' },
        },
        c,
      );

      expect(sessions.start).toHaveBeenCalledTimes(1);
      expect(c.close).not.toHaveBeenCalled();
      expect(sent(c)).toStrictEqual([]);
    });

    // A socket may hold several turns at once, which is exactly what the
    // extension does.
    it('allows a second turn start on the same connection', () => {
      const start = () =>
        gateway.handleSessionStart(
          {
            type: 'client.session.start',
            languagePair: { source: 'vi', target: 'en' },
          },
          socket,
        );
      start();
      expect(() => start()).not.toThrow();
      expect(sessions.start).toHaveBeenCalledTimes(2);
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

    // A tab built before the language pair replaced `direction` still sends the
    // old field. No wire compat is kept, but the refusal is EMITTED: a thrown
    // one reaches the client as silence and the stale page never learns to
    // reload.
    it('answers a turn start carrying the legacy direction with client_outdated', () => {
      gateway.handleSessionStart(
        {
          type: 'client.session.start',
          direction: 'vi_to_en',
          turnId: 'stale-turn',
        },
        socket,
      );
      expect(sessions.start).not.toHaveBeenCalled();
      expect(
        JSON.parse(
          (socket.send as Mock<(data: string) => void>).mock.lastCall![0],
        ),
      ).toMatchObject({
        type: 'server.error',
        code: 'client_outdated',
        turnId: 'stale-turn',
      });
    });

    it('forwards twoWay and a detect source on a turn start, for the session to decide', () => {
      gateway.handleSessionStart(
        {
          type: 'client.session.start',
          languagePair: { source: 'detect', target: 'en' },
          twoWay: true,
          turnId: 't1',
        },
        socket,
      );
      expect(sessions.start).toHaveBeenCalledWith(
        socket,
        expect.objectContaining({
          languagePair: { source: 'detect', target: 'en' },
          twoWay: true,
        }),
        't1',
        undefined,
      );
    });

    it('refuses direction even beside a valid language pair, like REST', () => {
      gateway.handleSessionStart(
        {
          type: 'client.session.start',
          direction: 'vi_to_en',
          languagePair: { source: 'vi', target: 'en' },
        },
        socket,
      );
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
      const client = { send: vi.fn(), close: vi.fn() };
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
        auth,
        terminator,
      );
      const client = { send: vi.fn(), close: vi.fn() };
      own.handleConnection(client, {
        headers: {},
        [VERIFIED_USER_ID]: 'user_1',
      });
      expect(terminator.terminate('user_1')).toBe(1);
      expect(client.close).toHaveBeenCalled();
    });
  });
});
