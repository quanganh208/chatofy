import { describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n/server', () => ({ getT: () => Promise.resolve((key: string) => key) }));

const { default: ConferenceLayout } = await import('./layout');

describe('the conference routes', () => {
  it('render their page', () => {
    expect(ConferenceLayout({ children: 'room' })).toBe('room');
  });
});
