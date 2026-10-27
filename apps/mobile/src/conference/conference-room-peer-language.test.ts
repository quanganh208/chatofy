import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LanguageCode } from '@chatofy/types/domain';
import { PeerLanguages, peerSourceLanguage } from './conference-room-peer-language.ts';
import { SubtitleTurnOrder } from './subtitle-turn-order.ts';

describe('peerSourceLanguage', () => {
  it('reads the language a joining peer speaks', () => {
    assert.equal(
      peerSourceLanguage({ socketId: 'a', displayName: 'An', sourceLanguage: 'zh' }),
      'zh',
    );
  });

  it('is undefined when an older server sends no language', () => {
    assert.equal(peerSourceLanguage({ socketId: 'a', displayName: 'An' }), undefined);
  });

  it('never guesses from a language the app does not support or a malformed event', () => {
    assert.equal(peerSourceLanguage({ socketId: 'a', sourceLanguage: 'fr' }), undefined);
    assert.equal(peerSourceLanguage({ socketId: 'a', sourceLanguage: 7 }), undefined);
    assert.equal(peerSourceLanguage(null), undefined);
    assert.equal(peerSourceLanguage('vi'), undefined);
  });
});

describe('PeerLanguages', () => {
  it('reports the room set when a peer joins, changes or leaves', () => {
    const heard: LanguageCode[][] = [];
    const room = new PeerLanguages((languages) => heard.push(languages));
    room.set('a', 'en');
    room.set('b', 'zh');
    room.set('a', 'vi');
    room.set('b', undefined);
    assert.deepEqual(heard, [['en'], ['en', 'zh'], ['vi', 'zh'], ['vi']]);
    assert.deepEqual(room.values(), ['vi']);
  });

  it('stays quiet when nothing changed', () => {
    let calls = 0;
    const room = new PeerLanguages(() => calls++);
    room.set('a', 'en');
    room.set('a', 'en');
    // A peer whose join named no language leaves without touching the set.
    room.set('ghost', undefined);
    assert.equal(calls, 1);
  });

  it('works as a detached callback', () => {
    const room = new PeerLanguages(() => {});
    const set = room.set;
    set('a', 'zh');
    assert.deepEqual(room.values(), ['zh']);
  });
});

describe('SubtitleTurnOrder', () => {
  /** Replays frames and returns what the line shows after each, as the room listener does. */
  function replay(frames: [turnId: string, text: string][]): (string | undefined)[] {
    const order = new SubtitleTurnOrder();
    let line: string | undefined;
    return frames.map(([turnId, text]) => {
      if (order.accept('speaker', turnId, text.length > 0) && text.length > 0) line = text;
      return line;
    });
  }

  it('never shows the older turn again once the newer has text', () => {
    assert.deepEqual(
      replay([
        ['t1', 'xin chào'],
        ['t2', 'hôm nay'],
        ['t1', 'xin chào các bạn'], // turn 1's late final
        ['t2', 'hôm nay trời đẹp'],
        ['t1', 'xin chào các bạn!'],
      ]),
      ['xin chào', 'hôm nay', 'hôm nay', 'hôm nay trời đẹp', 'hôm nay trời đẹp'],
    );
  });

  it("still shows an older turn's final while the newer one has no text yet", () => {
    assert.deepEqual(
      replay([
        ['t1', 'one'],
        ['t2', ''], // turn 2 opened, nothing on this channel yet
        ['t1', 'one two'],
        ['t2', 'three'],
        ['t1', 'one two!'],
      ]),
      ['one', 'one', 'one two', 'three', 'three'],
    );
  });

  it('keeps an empty frame of the shown turn current, so its final can schedule the clear', () => {
    const order = new SubtitleTurnOrder();
    assert.equal(order.accept('s', 't1', true), true);
    assert.equal(order.accept('s', 't1', false), true);
    assert.equal(order.accept('s', 't2', true), true);
    assert.equal(order.accept('s', 't1', false), false);
  });

  it('ranks each speaker on their own', () => {
    const order = new SubtitleTurnOrder();
    order.accept('a', 'a1', true);
    order.accept('a', 'a2', true);
    // Speaker a moving on says nothing about speaker b's turns.
    assert.equal(order.accept('b', 'b1', true), true);
    assert.equal(order.accept('a', 'a1', true), false);
    assert.equal(order.accept('b', 'b1', true), true);
  });

  it('forgets a speaker who left', () => {
    const order = new SubtitleTurnOrder();
    order.accept('a', 't1', true);
    order.accept('a', 't2', true);
    order.forget('a');
    assert.equal(order.accept('a', 't1', true), true);
  });
});
