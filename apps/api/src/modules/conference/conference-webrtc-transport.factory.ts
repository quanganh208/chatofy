import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { types } from 'mediasoup';
import type { Env } from '../../config/env.schema';

/** How long a minted TURN credential stays valid. */
const TURN_CREDENTIAL_TTL_S = 3600;

export interface TurnIceServer {
  urls: string;
  username: string;
  credential: string;
}

/**
 * Builds WebRTC transports and the TURN credentials that go with them.
 *
 * mediasoup's server-side WebRtcTransport does NOT take iceServers — TURN is a
 * client-side concept. The server returns TURN credentials in the transport
 * create response so the client's mediasoup-client Device can relay through it.
 *
 * coturn runs with --use-auth-secret (TURN REST API). Credentials are:
 *   username = "${expiry_unix_ts}:${userId}"
 *   password = base64(HMAC-SHA1(COTURN_SECRET, username))
 */
@Injectable()
export class ConferenceWebRtcTransportFactory {
  private readonly announcedIp: string;
  private readonly turnUrl: string | undefined;
  private readonly turnSecret: string | undefined;

  constructor(config: ConfigService<Env, true>) {
    this.announcedIp = config.get('MEDIASOUP_ANNOUNCED_IP', { infer: true });
    this.turnUrl = config.get('TURN_URL', { infer: true });
    this.turnSecret = config.get('COTURN_SECRET', { infer: true });
  }

  create(router: types.Router): Promise<types.WebRtcTransport> {
    return router.createWebRtcTransport({
      listenInfos: [
        { protocol: 'udp', ip: '0.0.0.0', announcedAddress: this.announcedIp },
        { protocol: 'tcp', ip: '0.0.0.0', announcedAddress: this.announcedIp },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });
  }

  /** TURN servers for `userId`, or none when TURN is not configured. */
  iceServers(userId: string, nowMs = Date.now()): TurnIceServer[] {
    if (!this.turnUrl || !this.turnSecret) return [];
    const expiry = Math.floor(nowMs / 1000) + TURN_CREDENTIAL_TTL_S;
    const username = `${expiry}:${userId}`;
    const credential = createHmac('sha1', this.turnSecret)
      .update(username)
      .digest('base64');
    return [{ urls: this.turnUrl, username, credential }];
  }
}
