import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSfuPeerConnection, withoutTransportQuery } from './sfu-peer-connection';

const CLOUDFLARE: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  {
    urls: [
      'turn:turn.cloudflare.com:3478?transport=udp',
      'turn:turn.cloudflare.com:3478?transport=tcp',
      'turns:turn.cloudflare.com:5349?transport=tcp',
      'turns:turn.cloudflare.com:443?transport=tcp',
    ],
    username: 'u',
    credential: 'c',
  },
];

describe('withoutTransportQuery', () => {
  it('drops ?transport= and the duplicates it leaves, keeping credentials', () => {
    expect(withoutTransportQuery(CLOUDFLARE)).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      {
        urls: [
          'turn:turn.cloudflare.com:3478',
          'turns:turn.cloudflare.com:5349',
          'turns:turn.cloudflare.com:443',
        ],
        username: 'u',
        credential: 'c',
      },
    ]);
  });
});

describe('createSfuPeerConnection', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A constructor that refuses any TURN URL with a query, as WebKit does. */
  function stubWebKit() {
    const seen: RTCConfiguration[] = [];
    vi.stubGlobal(
      'RTCPeerConnection',
      class {
        constructor(config: RTCConfiguration) {
          seen.push(config);
          const urls = (config.iceServers ?? []).flatMap((s) =>
            Array.isArray(s.urls) ? s.urls : [s.urls],
          );
          if (urls.some((u) => u.startsWith('turn') && u.includes('?'))) {
            throw new DOMException('Invalid TURN URL query string', 'SyntaxError');
          }
        }
      },
    );
    return seen;
  }

  it('passes the servers through untouched when the browser accepts them', () => {
    const seen: RTCConfiguration[] = [];
    vi.stubGlobal(
      'RTCPeerConnection',
      class {
        constructor(config: RTCConfiguration) {
          seen.push(config);
        }
      },
    );
    createSfuPeerConnection({ iceServers: CLOUDFLARE });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.iceServers).toBe(CLOUDFLARE);
  });

  it('retries without ?transport= when the browser refuses the query', () => {
    const seen = stubWebKit();
    createSfuPeerConnection({ bundlePolicy: 'max-bundle', iceServers: CLOUDFLARE });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual({
      bundlePolicy: 'max-bundle',
      iceServers: withoutTransportQuery(CLOUDFLARE),
    });
  });

  it('rethrows any other failure', () => {
    vi.stubGlobal(
      'RTCPeerConnection',
      class {
        constructor() {
          throw new DOMException('nope', 'NotSupportedError');
        }
      },
    );
    expect(() => createSfuPeerConnection({ iceServers: CLOUDFLARE })).toThrow('nope');
  });
});
