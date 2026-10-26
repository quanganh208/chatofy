/**
 * Builds the call's `RTCPeerConnection`s so every browser engine accepts the ICE
 * servers the join reply hands out.
 *
 * Cloudflare's TURN list spells the transport the RFC 7065 way
 * (`turn:turn.cloudflare.com:3478?transport=udp`). Chromium and Firefox accept
 * that; WebKit refuses every TURN URL carrying a query ("Invalid TURN URL query
 * string", a `SyntaxError` from the constructor), so the call never started. On
 * that refusal the connection is built again from the same servers without the
 * query: `turn:` then means UDP and `turns:` TLS over TCP, which keeps the
 * port-443 TLS relay for networks that block UDP. Only the refusing engine pays
 * for the narrower list.
 */
import { conferenceDebug } from './conference-debug-log';

const TRANSPORT_QUERY = /\?transport=(udp|tcp)$/i;

/** The same servers with `?transport=` dropped from TURN URLs, duplicates removed. */
export function withoutTransportQuery(iceServers: RTCIceServer[]): RTCIceServer[] {
  return iceServers.map((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return { ...server, urls: [...new Set(urls.map((url) => url.replace(TRANSPORT_QUERY, '')))] };
  });
}

export function createSfuPeerConnection(config: RTCConfiguration): RTCPeerConnection {
  try {
    return new RTCPeerConnection(config);
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'SyntaxError') || !config.iceServers)
      throw err;
    conferenceDebug(`ICE servers refused (${err.message}); retrying without ?transport=`);
    return new RTCPeerConnection({
      ...config,
      iceServers: withoutTransportQuery(config.iceServers),
    });
  }
}
