import { describe, expect, it, vi } from 'vitest';

/**
 * Every `/conference` route sits under this layout, so this is the whole gate:
 * a build without the flag answers 404 for the lobby and every room.
 */

const flags = vi.hoisted(() => ({ conference: false }));
vi.mock('@/config/feature-flags', () => ({ isConferenceEnabled: () => flags.conference }));

const NOT_FOUND = 'NEXT_NOT_FOUND';
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
}));
vi.mock('@/i18n/server', () => ({ getT: () => Promise.resolve((key: string) => key) }));

const { default: ConferenceLayout } = await import('./layout');

describe('the conference routes', () => {
  it('answer 404 in a build that does not ship conferencing', () => {
    flags.conference = false;
    expect(() => ConferenceLayout({ children: 'room' })).toThrow(NOT_FOUND);
  });

  it('render in a build that does', () => {
    flags.conference = true;
    expect(ConferenceLayout({ children: 'room' })).toBe('room');
  });
});
