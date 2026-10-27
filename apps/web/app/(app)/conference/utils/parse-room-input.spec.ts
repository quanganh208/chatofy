import { describe, expect, it } from 'vitest';
import { parseRoomInput } from './parse-room-input';

const ROOM = 'cl9ebqhxk00003b600tymydho';

describe('parseRoomInput', () => {
  it('accepts a bare room id', () => {
    expect(parseRoomInput(ROOM)).toBe(ROOM);
  });

  it('takes the room out of an invite link', () => {
    expect(parseRoomInput(`https://chatofy.example/conference/${ROOM}`)).toBe(ROOM);
  });

  it('ignores the name and language an old link carried', () => {
    expect(parseRoomInput(`https://chatofy.example/conference/${ROOM}?name=An&lang=vi`)).toBe(ROOM);
  });

  it('reads a lobby link that named the room in its query', () => {
    expect(parseRoomInput(`https://chatofy.example/conference?room=${ROOM}`)).toBe(ROOM);
  });

  it('trims surrounding space', () => {
    expect(parseRoomInput(`  ${ROOM}  `)).toBe(ROOM);
  });

  it('refuses text that cannot name a room', () => {
    expect(parseRoomInput('hello')).toBeNull();
  });

  it('refuses empty input', () => {
    expect(parseRoomInput('')).toBeNull();
  });
});
