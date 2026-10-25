import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dropPeer,
  peerForMid,
  publishTracksFromTransceivers,
  recordMids,
  type SfuMidMap,
} from './sfu-mid-map.ts';

describe('sfu-mid-map', () => {
  describe('recordMids / peerForMid', () => {
    it('maps each recorded mid to its peer and kind', () => {
      const map: SfuMidMap = new Map();
      recordMids(map, [
        { mid: '0', socketId: 'a', kind: 'audio' },
        { mid: '1', socketId: 'a', kind: 'video' },
      ]);
      assert.deepEqual(peerForMid(map, '0'), { socketId: 'a', kind: 'audio' });
      assert.deepEqual(peerForMid(map, '1'), { socketId: 'a', kind: 'video' });
    });

    it('returns undefined for a mid no reply announced', () => {
      assert.equal(peerForMid(new Map(), '7'), undefined);
    });

    it('keeps earlier mids when a later reply adds more', () => {
      const map: SfuMidMap = new Map();
      recordMids(map, [{ mid: '0', socketId: 'a', kind: 'audio' }]);
      recordMids(map, [{ mid: '2', socketId: 'b', kind: 'audio' }]);
      assert.equal(peerForMid(map, '0')?.socketId, 'a');
      assert.equal(peerForMid(map, '2')?.socketId, 'b');
    });
  });

  describe('dropPeer', () => {
    it('removes only the departed peer and returns its mids', () => {
      const map: SfuMidMap = new Map();
      recordMids(map, [
        { mid: '0', socketId: 'a', kind: 'audio' },
        { mid: '1', socketId: 'a', kind: 'video' },
        { mid: '2', socketId: 'b', kind: 'audio' },
      ]);
      assert.deepEqual(dropPeer(map, 'a').sort(), ['0', '1']);
      assert.equal(peerForMid(map, '0'), undefined);
      assert.equal(peerForMid(map, '2')?.socketId, 'b');
    });

    it('returns an empty list for an unknown peer', () => {
      const map: SfuMidMap = new Map();
      recordMids(map, [{ mid: '0', socketId: 'a', kind: 'audio' }]);
      assert.deepEqual(dropPeer(map, 'z'), []);
      assert.equal(map.size, 1);
    });
  });

  describe('publishTracksFromTransceivers', () => {
    it('maps transceivers to their mid and track kind', () => {
      assert.deepEqual(
        publishTracksFromTransceivers([
          { mid: '0', sender: { track: { kind: 'audio' } } },
          { mid: '1', sender: { track: { kind: 'video' } } },
        ]),
        [
          { mid: '0', kind: 'audio' },
          { mid: '1', kind: 'video' },
        ],
      );
    });

    it('throws when a transceiver has no mid yet', () => {
      assert.throws(
        () => publishTracksFromTransceivers([{ mid: null, sender: { track: { kind: 'audio' } } }]),
        /no mid/,
      );
    });

    it('throws when a transceiver carries no track', () => {
      assert.throws(
        () => publishTracksFromTransceivers([{ mid: '0', sender: { track: null } }]),
        /no audio or video track/,
      );
    });
  });
});
