import type { ConferenceIceServer } from '@chatofy/types';

/** Cloudflare's public STUN: free, unlimited, and always offered. */
const CLOUDFLARE_STUN: ConferenceIceServer = {
  urls: 'stun:stun.cloudflare.com:3478',
};

/**
 * Port 53 is DNS. Cloudflare lists TURN on it, and advises dropping it for
 * clients that do not trickle ICE; browsers also refuse it in some setups.
 */
const PORT_53 = /:53(\?|$)/;
const TURN_URL = /^turns?:/;

/**
 * The join reply's ICE servers: STUN, then the TURN entries of `generated`
 * (Cloudflare's own STUN entry in that list is dropped as a duplicate), with
 * every port-53 URL removed.
 */
export function iceServersFrom(
  generated: ConferenceIceServer[] | null,
): ConferenceIceServer[] {
  const turn: ConferenceIceServer[] = [];
  for (const server of generated ?? []) {
    const urls = (
      Array.isArray(server.urls) ? server.urls : [server.urls]
    ).filter((url) => TURN_URL.test(url) && !PORT_53.test(url));
    if (urls.length > 0) turn.push({ ...server, urls });
  }
  return [CLOUDFLARE_STUN, ...turn];
}
