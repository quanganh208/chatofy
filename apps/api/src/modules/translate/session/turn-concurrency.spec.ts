import { describe, expect, it } from 'vitest';
import { MAX_TURN_BYTES } from './turn-audio';
import {
  MAX_BUFFERED_BYTES_PER_SOCKET,
  MAX_CONCURRENT_TURNS_GLOBAL,
  MAX_CONCURRENT_TURNS_PER_SOCKET,
} from './turn-concurrency';

/**
 * Pins what the concurrency ceilings cost in memory.
 *
 * These assertions look tautological and are not. Raising a turn ceiling is
 * motivated by real-time-factor measurements, which describe CPU and say nothing
 * whatsoever about memory — yet every extra open turn buffers its own audio up to
 * `MAX_TURN_BYTES`. Pinning the numbers means a change to either ceiling fails
 * here and puts the memory bound in front of whoever is making it, rather than
 * leaving it to be noticed later under load.
 *
 * If a failure here is intentional, update the figures AND the reasoning on the
 * constants. Do not just re-derive the expectation from the ceiling.
 *
 * Byte counts are decimal MB throughout, matching the figures written on the
 * constants themselves.
 */
describe('turn concurrency ceilings', () => {
  it('buffers at most 5.76 MB of inbound audio per turn', () => {
    expect(MAX_TURN_BYTES).toBe(5_760_000);
  });

  it('lets one socket pin 17.28 MB across its turns', () => {
    expect(MAX_CONCURRENT_TURNS_PER_SOCKET).toBe(3);
    expect(MAX_BUFFERED_BYTES_PER_SOCKET).toBe(17_280_000);
  });

  it('lets the whole process pin 34.56 MB at the global ceiling', () => {
    expect(MAX_CONCURRENT_TURNS_GLOBAL).toBe(6);
    expect(MAX_TURN_BYTES * MAX_CONCURRENT_TURNS_GLOBAL).toBe(34_560_000);
  });

  // The global ceiling has to be reachable by more than one socket, or it is just
  // the per-socket ceiling written twice and the sidecars stay unguarded.
  it('keeps the global ceiling above one socket’s share', () => {
    expect(MAX_CONCURRENT_TURNS_GLOBAL).toBeGreaterThan(
      MAX_CONCURRENT_TURNS_PER_SOCKET,
    );
  });
});
