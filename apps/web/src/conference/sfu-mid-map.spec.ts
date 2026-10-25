import { describe, expect, it } from 'vitest';
import {
  dropPeer,
  peerForMid,
  publishTracksFromTransceivers,
  recordMids,
  type MidMap,
} from './sfu-mid-map';

function transceiver(mid: string | null, kind: string | null) {
  return { mid, sender: { track: kind === null ? null : { kind } } };
}

describe('sfu mid map', () => {
  it('looks up the peer and kind of each recorded mid', () => {
    const map: MidMap = new Map();
    recordMids(map, [
      { mid: '0', socketId: 'alice', kind: 'audio' },
      { mid: '1', socketId: 'alice', kind: 'video' },
    ]);
    expect(peerForMid(map, '0')).toEqual({ socketId: 'alice', kind: 'audio' });
    expect(peerForMid(map, '1')).toEqual({ socketId: 'alice', kind: 'video' });
  });

  it('returns undefined for a mid it never recorded, or none at all', () => {
    const map: MidMap = new Map();
    recordMids(map, [{ mid: '0', socketId: 'alice', kind: 'audio' }]);
    expect(peerForMid(map, '7')).toBeUndefined();
    expect(peerForMid(map, null)).toBeUndefined();
  });

  it('drops exactly the departed peer’s mids and keeps everyone else’s', () => {
    const map: MidMap = new Map();
    recordMids(map, [
      { mid: '0', socketId: 'alice', kind: 'audio' },
      { mid: '1', socketId: 'bob', kind: 'audio' },
      { mid: '2', socketId: 'alice', kind: 'video' },
    ]);
    expect(dropPeer(map, 'alice')).toEqual(['0', '2']);
    expect([...map.keys()]).toEqual(['1']);
    expect(dropPeer(map, 'carol')).toEqual([]);
  });
});

describe('publishTracksFromTransceivers', () => {
  it('maps each negotiated sender to its mid and kind', () => {
    expect(
      publishTracksFromTransceivers([transceiver('0', 'audio'), transceiver('1', 'video')]),
    ).toEqual([
      { mid: '0', kind: 'audio' },
      { mid: '1', kind: 'video' },
    ]);
  });

  it('throws when a transceiver has no mid yet', () => {
    expect(() => publishTracksFromTransceivers([transceiver(null, 'audio')])).toThrow(/mid/);
  });

  it('throws when a sender carries no audio or video track', () => {
    expect(() => publishTracksFromTransceivers([transceiver('0', null)])).toThrow();
  });
});
