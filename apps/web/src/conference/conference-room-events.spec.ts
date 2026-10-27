import { describe, expect, it } from 'vitest';
import { parseRoomEvent } from './conference-room-events';

describe('parseRoomEvent — chat refusals', () => {
  it('reads a rate-limit refusal of a sent message', () => {
    expect(parseRoomEvent({ event: 'conference.chat', data: { error: 'limit_reached' } })).toEqual({
      type: 'chat-refused',
      refusal: 'rate-limited',
    });
  });

  it('reads any other refusal as a message that was not sent', () => {
    for (const error of ['text_too_long', 'invalid_payload', 'not_in_room']) {
      expect(parseRoomEvent({ event: 'conference.chat', data: { error } })).toEqual({
        type: 'chat-refused',
        refusal: 'not-sent',
      });
    }
  });

  it('ignores a conference.chat frame that carries no refusal', () => {
    expect(parseRoomEvent({ event: 'conference.chat', data: { text: 'hi' } })).toBeNull();
  });

  it('still reads a delivered message as chat', () => {
    const message = {
      id: 'm-1',
      socketId: 's-1',
      displayName: 'Alice',
      text: 'hello',
      lang: 'en',
      sentAt: 1,
    };
    expect(parseRoomEvent({ event: 'conference.chat.message', data: message })).toEqual({
      type: 'chat',
      message,
    });
  });
});

describe('parseRoomEvent — media', () => {
  it('reads a peer whose tracks went live on the SFU', () => {
    expect(
      parseRoomEvent({ event: 'conference.media.published', data: { socketId: 's-1' } }),
    ).toEqual({ type: 'media-published', socketId: 's-1' });
  });

  it('drops a published announcement with no socket id', () => {
    expect(parseRoomEvent({ event: 'conference.media.published', data: {} })).toBeNull();
  });
});

describe('parseRoomEvent — peers', () => {
  it('reads a join that names the peer’s language', () => {
    expect(
      parseRoomEvent({
        event: 'conference.peer.joined',
        data: { socketId: 's-1', displayName: 'Alice', userId: 'u-1', sourceLanguage: 'zh' },
      }),
    ).toEqual({ type: 'peer-joined', socketId: 's-1', displayName: 'Alice', sourceLanguage: 'zh' });
  });

  it('still reads a join from a gateway that does not send the language', () => {
    expect(
      parseRoomEvent({
        event: 'conference.peer.joined',
        data: { socketId: 's-1', displayName: 'Alice' },
      }),
    ).toEqual({ type: 'peer-joined', socketId: 's-1', displayName: 'Alice' });
  });

  it('keeps a join whose language this build does not know, without the language', () => {
    expect(
      parseRoomEvent({
        event: 'conference.peer.joined',
        data: { socketId: 's-1', displayName: 'Alice', sourceLanguage: 'fr' },
      }),
    ).toEqual({ type: 'peer-joined', socketId: 's-1', displayName: 'Alice' });
  });
});

describe('parseRoomEvent — translation broadcast refusals', () => {
  it('reads a refused broadcast with its code', () => {
    expect(
      parseRoomEvent({
        event: 'conference.translation.broadcast',
        data: { error: 'limit_reached' },
      }),
    ).toEqual({ type: 'broadcast-refused', code: 'limit_reached' });
  });

  it('ignores a broadcast frame that carries no refusal', () => {
    expect(
      parseRoomEvent({ event: 'conference.translation.broadcast', data: { audio: {} } }),
    ).toBeNull();
  });
});
