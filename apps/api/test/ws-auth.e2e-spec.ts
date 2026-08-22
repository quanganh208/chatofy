import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo, Socket } from 'node:net';
import { WS_SUBPROTOCOL } from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { USER_REPOSITORY } from '../src/modules/users/interfaces/user-repository.interface';
import { AiProvidersFactory } from '../src/modules/translate/providers/ai-providers.factory';
import { TranslationSessionService } from '../src/modules/translate/services/translation-session.service';
import { LiveTranslateSessionService } from '../src/modules/translate/services/live-translate-session.service';
import { InMemoryUserRepository } from './utils/in-memory-user.repository';
import {
  expiredTokenFor,
  registerAndLogin,
  type Identity,
} from './utils/auth-fixture';

/** The outcome of one raw HTTP upgrade attempt against /ws/translate. */
interface UpgradeResult {
  /** 101 when the handshake completed; 401 when it was refused. */
  status: number;
  /** The subprotocol the server selected, if any. */
  protocol?: string;
  /** The raw socket, when one was actually created. */
  socket?: Socket;
}

function upgradeHeaders(protocolHeader?: string): Record<string, string> {
  return {
    Connection: 'Upgrade',
    Upgrade: 'websocket',
    'Sec-WebSocket-Version': '13',
    'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
    ...(protocolHeader === undefined
      ? {}
      : { 'Sec-WebSocket-Protocol': protocolHeader }),
  };
}

/**
 * Drives the handshake by hand rather than through a WebSocket client.
 *
 * Browser and node clients both collapse a refused upgrade into a generic error
 * carrying no status, and the claim under test is specifically that the refusal
 * is an HTTP 401 arriving BEFORE any socket exists. Only the raw request can
 * tell a 401 response from a 101 upgrade.
 */
function attemptUpgrade(
  port: number,
  protocolHeader?: string,
): Promise<UpgradeResult> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      port,
      path: '/ws/translate',
      headers: upgradeHeaders(protocolHeader),
    });
    req.on('upgrade', (res, socket) => {
      resolve({
        status: res.statusCode ?? 101,
        protocol: res.headers['sec-websocket-protocol'],
        socket,
      });
    });
    req.on('response', (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0 });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('WebSocket upgrade auth (e2e)', () => {
  let app: INestApplication;
  let port: number;
  let identity: Identity;
  let startTurn: jest.SpyInstance;
  let startLive: jest.SpyInstance;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) })
      .overrideProvider(USER_REPOSITORY)
      .useValue(new InMemoryUserRepository())
      .overrideProvider(AiProvidersFactory)
      .useValue({ makeProviders: () => ({}) })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;
    identity = await registerAndLogin(app);

    startTurn = jest.spyOn(app.get(TranslationSessionService), 'start');
    startLive = jest.spyOn(app.get(LiveTranslateSessionService), 'start');
  });

  afterEach(() => {
    startTurn.mockClear();
    startLive.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('completes the handshake for a valid token and echoes the protocol name', async () => {
    const res = await attemptUpgrade(
      port,
      `${WS_SUBPROTOCOL}, ${identity.accessToken}`,
    );
    expect(res.status).toBe(101);
    // The specific failure this guards: a server selecting NONE of the offered
    // subprotocols gets a handshake that succeeds and a browser that closes the
    // connection an instant later.
    expect(res.protocol).toBe(WS_SUBPROTOCOL);
    // And never the credential back on the wire.
    expect(res.protocol).not.toContain(identity.accessToken);
    res.socket?.destroy();
  });

  it('refuses a garbage token with HTTP 401 at the upgrade, creating no socket', async () => {
    const res = await attemptUpgrade(port, `${WS_SUBPROTOCOL}, not-a-jwt`);
    expect(res.status).toBe(401);
    expect(res.socket).toBeUndefined();
  });

  it('refuses an expired token minted by the app itself', async () => {
    const expired = expiredTokenFor(app, identity.userId);
    const res = await attemptUpgrade(port, `${WS_SUBPROTOCOL}, ${expired}`);
    expect(res.status).toBe(401);
  });

  it('refuses a connection offering no subprotocol at all', async () => {
    expect((await attemptUpgrade(port, undefined)).status).toBe(401);
  });

  it('refuses an offer carrying the protocol name but no token', async () => {
    expect((await attemptUpgrade(port, WS_SUBPROTOCOL)).status).toBe(401);
  });

  it('never reaches a session service, even when a start frame is pipelined into the same tick', async () => {
    // The behavioural claim, not merely that the connection ended: a rejected
    // upgrade leaves no socket for Nest to bind handlers to, so a start frame
    // written the instant the request goes out has nothing to dispatch to.
    const req = http.request({
      port,
      path: '/ws/translate',
      headers: upgradeHeaders(`${WS_SUBPROTOCOL}, not-a-jwt`),
    });

    const status = await new Promise<number>((resolve, reject) => {
      req.on('response', (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('upgrade', (res) => resolve(res.statusCode ?? 101));
      req.on('error', reject);
      // Written BEFORE end so the bytes ride the same tick as the handshake
      // request, landing on the connection the instant the headers do.
      req.write(
        JSON.stringify({
          event: 'client.session.start',
          data: { type: 'client.session.start', direction: 'vi_to_en' },
        }),
      );
      req.end();
    });

    expect(status).toBe(401);
    await new Promise((r) => setTimeout(r, 100));
    expect(startTurn).not.toHaveBeenCalled();
    expect(startLive).not.toHaveBeenCalled();
  });

  it('survives a verifier that REJECTS rather than resolving falsy', async () => {
    // Node 24 defaults to --unhandled-rejections=throw, so a rejection escaping
    // the verify callback would end the process on an unauthenticated request.
    // Every refusal above runs that path already — verifyToken throws — so
    // reaching this assertion at all is most of the proof.
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    await attemptUpgrade(port, `${WS_SUBPROTOCOL}, also-not-a-jwt`);
    await new Promise((r) => setTimeout(r, 100));
    process.off('unhandledRejection', unhandled);

    expect(unhandled).not.toHaveBeenCalled();
    // Still answering, which a crash would have prevented.
    const after = await attemptUpgrade(
      port,
      `${WS_SUBPROTOCOL}, ${identity.accessToken}`,
    );
    expect(after.status).toBe(101);
    after.socket?.destroy();
  });
});
