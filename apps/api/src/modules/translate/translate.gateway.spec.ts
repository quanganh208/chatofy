import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock, Mocked } from 'vitest';
import { WsException } from '@nestjs/websockets';
import type { AuthAdapter } from '../auth/interfaces/auth-adapter.interface';
import { SessionTerminator } from '../auth/session-terminator';
import { VERIFIED_USER_ID } from './ws-auth';
import { TranslateGateway } from './translate.gateway';
import { TranslationMeter } from '../credits/translation-meter';
import { InMemoryCreditLedger } from '../../../test/utils/in-memory-credit-ledger';
import type {
  StreamSocket,
  TranslationSessionService,
} from './services/translation-session.service';

describe('TranslateGateway', () => {
  let sessions: Mocked<
    Pick<
      TranslationSessionService,
      | 'start'
      | 'pushFrame'
      | 'speculate'
      | 'end'
      | 'disconnect'
      | 'endAllForCredits'
      | 'refuseOverCapacity'
      | 'adoptConversation'
      | 'forgetConversation'
    >
  >;
  let auth: Mocked<AuthAdapter>;
  let gateway: TranslateGateway;
  let ledger: InMemoryCreditLedger;
  let meter: TranslationMeter;
  const socket: StreamSocket = { send: vi.fn() };

  beforeEach(() => {
    sessions = {
      start: vi.fn(),
      pushFrame: vi.fn(),
      speculate: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      endAllForCredits: vi.fn(),
      refuseOverCapacity: vi.fn().mockReturnValue(false),
      adoptConversation: vi.fn(),
      forgetConversation: vi.fn(),
    };
    // The real meter on the in-memory ledger: admission is part of every start.
    ledger = new InMemoryCreditLedger();
    meter = new TranslationMeter(ledger);
    meter.attach(socket, 'user_1', vi.fn());
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
      meter,
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
    it('passes valid session.start options to the session service', async () => {
      await gateway.handleSessionStart(
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

    it('forwards every option the contract carries, including the opt-in flags', async () => {
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
      await gateway.handleSessionStart(
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

    it('defaults the voice for a start that names no gender', async () => {
      // The field is optional on the wire so an older client keeps working; by
      // the time it reaches the state machine it must already be decided.
      await gateway.handleSessionStart(
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

    it('carries voice output and speed when the client sends them', async () => {
      await gateway.handleSessionStart(
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

    it('CLAMPS a speed outside the accepted range instead of refusing the turn', async () => {
      // The distinction this asserts is the whole reason the field is written the
      // way it is. A rejected `client.session.start` throws a WsException, which
      // AllExceptionsFilter swallows — so the client is answered with silence and
      // sits in "connecting" forever, with clearing its own storage the only way
      // out. A clamped value starts the conversation.
      await gateway.handleSessionStart(
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

    it('starts a turn for a client that sends neither new field', async () => {
      // web and api do not deploy together, so a tab loaded before this change is
      // still sending the old shape and must keep working unchanged.
      await gateway.handleSessionStart(
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
    const client = () => {
      const c = { send: vi.fn(), close: vi.fn() };
      meter.attach(c, 'user_1', vi.fn());
      return c;
    };
    const sent = (c: ReturnType<typeof client>) =>
      c.send.mock.calls.map(
        ([body]) => JSON.parse(String(body)) as { type: string; code?: string },
      );

    it('serves a turn start without closing or answering early', async () => {
      const c = client();
      await gateway.handleSessionStart(
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
    it('allows a second turn start on the same connection', async () => {
      const start = () =>
        gateway.handleSessionStart(
          {
            type: 'client.session.start',
            languagePair: { source: 'vi', target: 'en' },
          },
          socket,
        );
      await start();
      await start();
      expect(sessions.start).toHaveBeenCalledTimes(2);
    });
  });

  describe('credits', () => {
    const start = (client: StreamSocket, extra: Record<string, unknown> = {}) =>
      gateway.handleSessionStart(
        {
          type: 'client.session.start',
          languagePair: { source: 'vi', target: 'en' },
          turnId: 'turn-1',
          ...extra,
        },
        client,
      );
    const lastSent = (client: StreamSocket) =>
      JSON.parse(
        (client.send as Mock<(data: string) => void>).mock.lastCall![0],
      ) as Record<string, unknown>;

    it('refuses a start from a socket with no verified owner as credits_exhausted', async () => {
      const stranger: StreamSocket = { send: vi.fn() };
      await start(stranger);
      expect(sessions.start).not.toHaveBeenCalled();
      expect(lastSent(stranger)).toMatchObject({
        type: 'server.error',
        code: 'credits_exhausted',
        turnId: 'turn-1',
        remainingCreditSeconds: 0,
      });
    });

    it('refuses a start over a turn ceiling before it reaches the ledger', async () => {
      sessions.refuseOverCapacity.mockReturnValue(true);
      const admit = vi.spyOn(meter, 'admit');
      const openLease = vi.spyOn(ledger, 'openLease');
      await start(socket, { meeting: true });
      expect(sessions.refuseOverCapacity).toHaveBeenCalledWith(
        socket,
        expect.objectContaining({ meeting: true }),
        'turn-1',
        undefined,
      );
      expect(admit).not.toHaveBeenCalled();
      expect(openLease).not.toHaveBeenCalled();
      expect(sessions.start).not.toHaveBeenCalled();
    });

    it('refuses a start with credits_unavailable when the ledger cannot be reached', async () => {
      ledger.setUnavailable(true);
      await start(socket);
      expect(sessions.start).not.toHaveBeenCalled();
      expect(lastSent(socket)).toMatchObject({
        type: 'server.error',
        code: 'credits_unavailable',
        turnId: 'turn-1',
      });
    });

    it('keeps conversationId out of the options and bills the turn with it', async () => {
      sessions.start.mockReturnValue({ sessionId: 's1', extraTargets: 0 });
      const opened = vi.spyOn(meter, 'turnOpened');
      await start(socket, { conversationId: 'conv-1', voiceOutput: false });
      expect(sessions.start).toHaveBeenCalledWith(
        socket,
        {
          languagePair: { source: 'vi', target: 'en' },
          voiceGender: 'female',
          voiceOutput: false,
        },
        'turn-1',
        undefined,
      );
      // Captions into one language: 1 credit-second per accepted second.
      expect(opened).toHaveBeenCalledWith(socket, 's1', 1, 'conv-1');
    });

    it('prices a two-way start voiced while either language is still spoken', async () => {
      sessions.start.mockReturnValue({ sessionId: 's1', extraTargets: 0 });
      const opened = vi.spyOn(meter, 'turnOpened');
      await start(socket, {
        twoWay: true,
        voiceByLanguage: { vi: { speak: false } },
      });
      // English is still spoken: the turn may answer in it, so admission holds
      // the voiced rate and the turn reprices down at settle if it does not.
      expect(opened).toHaveBeenCalledWith(socket, 's1', 2, undefined);
    });

    it('prices a start captions-only when every language it may speak is muted', async () => {
      sessions.start.mockReturnValue({ sessionId: 's1', extraTargets: 0 });
      const opened = vi.spyOn(meter, 'turnOpened');
      await start(socket, {
        twoWay: true,
        voiceByLanguage: { vi: { speak: false }, en: { speak: false } },
      });
      expect(opened).toHaveBeenCalledWith(socket, 's1', 1, undefined);
    });

    it('prices a voiced turn by the extra targets start() actually ran', async () => {
      sessions.start.mockReturnValue({ sessionId: 's1', extraTargets: 2 });
      const opened = vi.spyOn(meter, 'turnOpened');
      await start(socket, { alsoTranslateInto: ['zh'] });
      expect(opened).toHaveBeenCalledWith(socket, 's1', 6, undefined);
    });

    it('opens two starts in arrival order even when the first waits on the ledger', async () => {
      const order: string[] = [];
      sessions.start.mockImplementation((_c, _o, turnId) => {
        order.push(String(turnId));
        return undefined;
      });
      let release!: () => void;
      const admit = meter.admit.bind(meter);
      vi.spyOn(meter, 'admit')
        .mockImplementationOnce(async (client, multiplier) => {
          await new Promise<void>((resolve) => (release = resolve));
          return admit(client, multiplier);
        })
        .mockImplementation(admit);
      const first = start(socket, { turnId: 'first' });
      const second = start(socket, { turnId: 'second' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(order).toEqual([]);
      release();
      await Promise.all([first, second]);
      expect(order).toEqual(['first', 'second']);
    });

    it('does not let one failed start poison the next', async () => {
      sessions.start
        .mockImplementationOnce(() => {
          throw new Error('boom');
        })
        .mockReturnValue(undefined);
      await start(socket, { turnId: 'a' });
      await start(socket, { turnId: 'b' });
      expect(sessions.start).toHaveBeenCalledTimes(2);
    });

    it('meters only what pushFrame accepted', () => {
      sessions.pushFrame.mockReturnValue(0.25);
      const onFrame = vi.spyOn(meter, 'onFrame');
      gateway.handleAudioFrame(
        { type: 'client.audio.frame', frame: validFrame },
        socket,
      );
      expect(onFrame).toHaveBeenCalledWith(socket, 's1', 0.25);
    });

    it('detaches the meter after the session service let go of the socket', () => {
      const detach = vi.spyOn(meter, 'detach');
      gateway.handleDisconnect(socket);
      expect(sessions.disconnect).toHaveBeenCalledWith(socket);
      expect(detach).toHaveBeenCalledWith(socket);
      expect(sessions.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
        detach.mock.invocationCallOrder[0]!,
      );
    });

    it('never surfaces a failed detach as an unhandled rejection', async () => {
      vi.spyOn(meter, 'detach').mockRejectedValue(new Error('ledger down'));
      expect(() => gateway.handleDisconnect(socket)).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    it('ends the listening turns of a connection the meter stopped', () => {
      const client = { send: vi.fn(), close: vi.fn() };
      const req: Record<string | symbol, unknown> = { headers: {} };
      req[VERIFIED_USER_ID] = 'user_2';
      const attach = vi.spyOn(meter, 'attach');
      gateway.handleConnection(client, req);
      const onStop = attach.mock.lastCall![2];
      onStop('credits_exhausted');
      expect(sessions.endAllForCredits).toHaveBeenCalledWith(
        client,
        'credits_exhausted',
        expect.any(Function),
      );
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
    it('answers a turn start carrying the legacy direction with client_outdated', async () => {
      await gateway.handleSessionStart(
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

    it('forwards twoWay and a detect source on a turn start, for the session to decide', async () => {
      await gateway.handleSessionStart(
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

    it('refuses direction even beside a valid language pair, like REST', async () => {
      await gateway.handleSessionStart(
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
        meter,
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
  /**
   * A client that reconnects after a drop names its conversation with a
   * `resume` key, and the gateway joins it back: the old socket's history moves
   * over, and the old socket — still open when it died without a close — is
   * ended before the new one's first start, so its turns no longer hold the
   * user's ceiling.
   */
  describe('reconnect', () => {
    type FakeSocket = StreamSocket & {
      close: Mock;
      terminate: Mock;
      ping: Mock;
      on: Mock;
    };
    const fake = (): FakeSocket => ({
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
      ping: vi.fn(),
      on: vi.fn(),
    });
    function connect(
      client: FakeSocket,
      userId: string,
      url = '/ws/translate',
    ) {
      const req: Record<string | symbol, unknown> = { headers: {}, url };
      req[VERIFIED_USER_ID] = userId;
      gateway.handleConnection(client, req);
      return client;
    }
    const withKey = '/ws/translate?resume=conv-key-0001';

    it('same user, same key: adopts first, disconnects the old socket once, then terminates it', () => {
      const old = connect(fake(), 'user_1', withKey);
      const next = connect(fake(), 'user_1', withKey);

      expect(sessions.adoptConversation).toHaveBeenCalledWith(old, next);
      expect(sessions.disconnect).toHaveBeenCalledTimes(1);
      expect(sessions.disconnect).toHaveBeenCalledWith(old);
      expect(
        sessions.adoptConversation.mock.invocationCallOrder[0],
      ).toBeLessThan(sessions.disconnect.mock.invocationCallOrder[0]!);
      expect(old.terminate).toHaveBeenCalledTimes(1);
      expect(old.close).not.toHaveBeenCalled();
    });

    it('a different user with the same key is never joined to it', () => {
      const old = connect(fake(), 'user_1', withKey);
      connect(fake(), 'user_2', withKey);
      expect(sessions.adoptConversation).not.toHaveBeenCalled();
      expect(old.terminate).not.toHaveBeenCalled();
    });

    it('no key: no supersede', () => {
      const old = connect(fake(), 'user_1');
      connect(fake(), 'user_1');
      expect(sessions.adoptConversation).not.toHaveBeenCalled();
      expect(old.terminate).not.toHaveBeenCalled();
    });

    it("queues the new socket's first start behind the old lease closing", async () => {
      const old = connect(fake(), 'user_1', withKey);
      let release!: () => void;
      const detach = vi
        .spyOn(meter, 'detach')
        .mockImplementation(
          () => new Promise<void>((resolve) => (release = resolve)),
        );
      const next = connect(fake(), 'user_1', withKey);
      expect(detach).toHaveBeenCalledWith(old);
      void gateway.handleSessionStart(
        {
          type: 'client.session.start',
          languagePair: { source: 'en', target: 'vi' },
        },
        next,
      );
      await Promise.resolve();
      expect(sessions.refuseOverCapacity).not.toHaveBeenCalled();
      release();
      await vi.waitFor(() =>
        expect(sessions.refuseOverCapacity).toHaveBeenCalled(),
      );
    });

    it('the disconnect ws reports after a supersede does not run the cleanup twice', () => {
      const old = connect(fake(), 'user_1', withKey);
      connect(fake(), 'user_1', withKey);
      gateway.handleDisconnect(old);
      expect(sessions.disconnect).toHaveBeenCalledTimes(1);
    });

    it('a cleanly closed socket keeps its history for a reconnect within the window', () => {
      vi.useFakeTimers();
      try {
        const old = connect(fake(), 'user_1', withKey);
        gateway.handleDisconnect(old);
        expect(sessions.disconnect).toHaveBeenCalledWith(old, {
          keepConversation: true,
        });

        vi.advanceTimersByTime(5_000);
        const next = connect(fake(), 'user_1', withKey);
        expect(sessions.adoptConversation).toHaveBeenCalledWith(old, next);
        expect(sessions.disconnect).toHaveBeenCalledTimes(1);
        expect(old.terminate).not.toHaveBeenCalled();
        vi.advanceTimersByTime(60_000);
        expect(sessions.forgetConversation).toHaveBeenCalledTimes(1);
        expect(sessions.forgetConversation).toHaveBeenCalledWith(old);
      } finally {
        vi.useRealTimers();
      }
    });

    it('forgets a parked history nobody reconnected for', () => {
      vi.useFakeTimers();
      try {
        const old = connect(fake(), 'user_1', withKey);
        gateway.handleDisconnect(old);
        vi.advanceTimersByTime(30_000);
        expect(sessions.forgetConversation).toHaveBeenCalledWith(old);
      } finally {
        vi.useRealTimers();
      }
    });

    it('logs a resubmitted start without passing the flag to the session', async () => {
      const client = connect(fake(), 'user_1');
      void gateway.handleSessionStart(
        {
          type: 'client.session.start',
          languagePair: { source: 'en', target: 'vi' },
          turnId: '7c1d4a0e-2f7b-4c1e-9a55-3c6f8d9e1b20',
          resubmit: true,
        },
        client,
      );
      await vi.waitFor(() => expect(sessions.start).toHaveBeenCalled());
      expect(JSON.stringify(sessions.start.mock.calls[0])).not.toContain(
        'resubmit',
      );
    });

    it('accepts a valid connection report and rejects an invalid one', () => {
      const report = {
        type: 'client.connection.report',
        closeCode: 1006,
        wasClean: false,
        sinceLastServerFrameMs: 400,
        downMs: 800,
        turnsInFlight: 2,
        resubmittedTurns: 1,
        attempt: 1,
        cause: 'closed',
      };
      expect(() =>
        gateway.handleConnectionReport(report, fake()),
      ).not.toThrow();
      expect(() =>
        gateway.handleConnectionReport({ ...report, cause: 'nope' }, fake()),
      ).toThrow(WsException);
    });

    it('logs one connection report per socket', () => {
      const log = vi
        .spyOn(
          (gateway as unknown as { logger: { log: (line: string) => void } })
            .logger,
          'log',
        )
        .mockImplementation(() => undefined);
      const report = {
        type: 'client.connection.report',
        closeCode: 1006,
        wasClean: false,
        sinceLastServerFrameMs: 1,
        downMs: 1,
        turnsInFlight: 0,
        resubmittedTurns: 0,
        attempt: 1,
        cause: 'closed',
      };
      const client = fake();
      gateway.handleConnectionReport(report, client);
      gateway.handleConnectionReport(report, client);
      expect(
        log.mock.calls.filter(([line]) =>
          String(line).startsWith('connection.report'),
        ),
      ).toHaveLength(1);
    });
  });

  describe('heartbeat', () => {
    it('terminates a socket that missed a pong, and only that one', () => {
      vi.useFakeTimers();
      try {
        const clients = new Set<
          StreamSocket & { terminate: Mock; ping: Mock; on: Mock }
        >();
        gateway.afterInit({ options: {}, clients, on: vi.fn() });
        const silent = {
          send: vi.fn(),
          terminate: vi.fn(),
          ping: vi.fn(),
          on: vi.fn(),
        };
        let pong: (() => void) | undefined;
        const answering = {
          send: vi.fn(),
          terminate: vi.fn(),
          ping: vi.fn(() => pong?.()),
          on: vi.fn((_event: string, listener: () => void) => {
            pong = listener;
          }),
        };
        for (const client of [silent, answering]) {
          const req: Record<string | symbol, unknown> = { headers: {} };
          req[VERIFIED_USER_ID] = 'user_1';
          gateway.handleConnection(client, req);
          clients.add(client);
        }

        vi.advanceTimersByTime(15_000);
        expect(silent.terminate).not.toHaveBeenCalled();
        vi.advanceTimersByTime(15_000);
        expect(silent.terminate).toHaveBeenCalledTimes(1);
        expect(answering.terminate).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('never ends a socket that cannot report a pong, and survives one that throws', () => {
      vi.useFakeTimers();
      try {
        const clients = new Set<
          StreamSocket & { terminate: Mock; ping?: Mock; on?: Mock }
        >();
        gateway.afterInit({ options: {}, clients, on: vi.fn() });
        const deaf = { send: vi.fn(), terminate: vi.fn() };
        const throwing = {
          send: vi.fn(),
          terminate: vi.fn(),
          ping: vi.fn(() => {
            throw new Error('socket gone');
          }),
          on: vi.fn(),
        };
        const silent = {
          send: vi.fn(),
          terminate: vi.fn(),
          ping: vi.fn(),
          on: vi.fn(),
        };
        for (const client of [deaf, throwing, silent]) {
          const req: Record<string | symbol, unknown> = { headers: {} };
          req[VERIFIED_USER_ID] = 'user_1';
          gateway.handleConnection(client, req);
          clients.add(client);
        }
        vi.advanceTimersByTime(30_000);
        expect(deaf.terminate).not.toHaveBeenCalled();
        expect(silent.terminate).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
