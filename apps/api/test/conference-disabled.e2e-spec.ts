import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The default, spelled out: AppModule reads the flag when it is first loaded,
// so an ambient CONFERENCE_ENABLED must not leak into this file.
vi.hoisted(() => {
  delete process.env.CONFERENCE_ENABLED;
});

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ConferenceWorkerService } from '../src/modules/conference/conference-worker.service';
import { USER_REPOSITORY } from '../src/modules/users/interfaces/user-repository.interface';
import { PrismaService } from '../src/prisma/prisma.service';
import { registerAndLogin, type Identity } from './utils/auth-fixture';
import { InMemoryUserRepository } from './utils/in-memory-user.repository';

/**
 * With CONFERENCE_ENABLED off — the default — nothing of conferencing loads:
 * no mediasoup worker is spawned, `/conference` is not routed, and
 * `/ws/conference` refuses the upgrade. A broken mediasoup install therefore
 * cannot affect an API that does not use it.
 */
describe('conferencing switched off (e2e)', () => {
  let app: INestApplication;
  let user: Identity;
  let base: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) })
      .overrideProvider(USER_REPOSITORY)
      .useValue(new InMemoryUserRepository())
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.listen(0);
    user = await registerAndLogin(app);
    const address = app.getHttpServer().address() as AddressInfo;
    base = `ws://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('spawns no mediasoup worker', () => {
    expect(() => app.get(ConferenceWorkerService, { strict: false })).toThrow();
  });

  it('does not route POST /conference', async () => {
    await request(app.getHttpServer())
      .post('/conference')
      .set('Authorization', user.bearer)
      .send({})
      .expect(404);
  });

  it('refuses the /ws/conference upgrade', async () => {
    const socket = new WebSocket(`${base}/ws/conference`, user.subprotocols);
    const opened = await new Promise<boolean>((resolve) => {
      socket.addEventListener('open', () => resolve(true), { once: true });
      socket.addEventListener('error', () => resolve(false), { once: true });
    });
    socket.close();
    expect(opened).toBe(false);
  });
});
