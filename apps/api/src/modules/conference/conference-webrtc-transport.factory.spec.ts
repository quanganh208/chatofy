import { createHmac } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../config/env.schema';
import { ConferenceWebRtcTransportFactory } from './conference-webrtc-transport.factory';

describe('ConferenceWebRtcTransportFactory.iceServers', () => {
  const factory = (values: Partial<Env>) =>
    new ConferenceWebRtcTransportFactory({
      get: (key: keyof Env) => values[key],
    } as unknown as ConfigService<Env, true>);

  it('returns no TURN server unless both the URL and the secret are set', () => {
    expect(factory({ TURN_URL: 'turn:x:3478' }).iceServers('u1')).toStrictEqual(
      [],
    );
    expect(factory({ COTURN_SECRET: 's' }).iceServers('u1')).toStrictEqual([]);
  });

  it('mints TURN REST credentials coturn can verify with the shared secret', () => {
    const now = Date.UTC(2026, 0, 1);
    const [server] = factory({
      TURN_URL: 'turn:x:3478',
      COTURN_SECRET: 'shared',
    }).iceServers('u1', now);

    const expiry = now / 1000 + 3600;
    expect(server).toStrictEqual({
      urls: 'turn:x:3478',
      username: `${expiry}:u1`,
      credential: createHmac('sha1', 'shared')
        .update(`${expiry}:u1`)
        .digest('base64'),
    });
  });
});
