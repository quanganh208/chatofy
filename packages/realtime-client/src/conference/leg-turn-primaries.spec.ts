import { describe, expect, it } from 'vitest';
import { LegTurnPrimaries } from './leg-turn-primaries.js';

describe('LegTurnPrimaries', () => {
  it('answers by the client turn id from the start, and by the session id once named', () => {
    const p = new LegTurnPrimaries();
    p.started('turn-1', 'en');
    expect(p.get('turn-1')).toBe('en');
    expect(p.get('session-1')).toBeUndefined();

    p.named('turn-1', 'session-1');
    expect(p.get('session-1')).toBe('en');
  });

  it('knows nothing of a turn it never saw start', () => {
    const p = new LegTurnPrimaries();
    p.named('turn-x', 'session-x');

    expect(p.get('turn-x')).toBeUndefined();
    expect(p.get('session-x')).toBeUndefined();
  });

  it('says a turn was dropped only the first time', () => {
    const p = new LegTurnPrimaries();

    expect(p.firstDrop('turn-1')).toBe(true);
    expect(p.firstDrop('turn-1')).toBe(false);
    expect(p.firstDrop('turn-2')).toBe(true);
  });

  it('forgets the oldest turns past its bound', () => {
    const p = new LegTurnPrimaries();
    for (let i = 0; i < 300; i += 1) p.started(`turn-${i}`, 'en');

    expect(p.get('turn-0')).toBeUndefined();
    expect(p.get('turn-299')).toBe('en');
  });
});
