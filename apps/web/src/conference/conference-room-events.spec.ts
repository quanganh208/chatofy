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
