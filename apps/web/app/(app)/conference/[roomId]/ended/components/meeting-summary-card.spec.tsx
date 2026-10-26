// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConferenceDetailResponse } from '@chatofy/types';
import { LocaleProvider } from '@/i18n/provider';
import { MeetingSummaryCard } from './meeting-summary-card';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** What the summary card reads out, in the reader's language (English by default). */

function room(over: Partial<ConferenceDetailResponse> = {}): ConferenceDetailResponse {
  return {
    id: 'cl9ebqhxk00003b600tymydho',
    status: 'ended',
    createdAt: '2026-10-26T09:00:00.000Z',
    ownerId: 'u-owner',
    startedAt: '2026-10-26T09:00:00.000Z',
    endedAt: '2026-10-26T09:42:20.000Z',
    participants: [
      {
        id: 'p-1',
        userId: 'u-owner',
        displayName: 'Alice',
        sourceLanguage: 'vi',
        status: 'left',
        joinedAt: '2026-10-26T09:00:00.000Z',
      },
      {
        id: 'p-2',
        userId: 'u-guest',
        displayName: '  ',
        sourceLanguage: 'en',
        status: 'left',
        joinedAt: '2026-10-26T09:01:00.000Z',
      },
    ],
    _count: { turns: 4 },
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function readouts(conference: ConferenceDetailResponse): string[] {
  act(() => {
    root.render(
      <LocaleProvider>
        <MeetingSummaryCard conference={conference} />
      </LocaleProvider>,
    );
  });
  return Array.from(container.querySelectorAll('dd')).map((dd) => dd.textContent ?? '');
}

describe('MeetingSummaryCard', () => {
  it('reads out the duration, everyone in the room, and the languages by name', () => {
    expect(readouts(room())).toEqual(['42 min', 'Alice, Guest', 'Vietnamese ↔ English']);
  });

  it('shows hours past the hour', () => {
    const [duration] = readouts(room({ endedAt: '2026-10-26T10:05:00.000Z' }));
    expect(duration).toBe('1 h 5 min');
  });

  it('never rounds a short meeting down to nothing', () => {
    const [duration] = readouts(room({ endedAt: '2026-10-26T09:00:10.000Z' }));
    expect(duration).toBe('1 min');
  });

  it('says the duration was not recorded while someone is still in the room', () => {
    const [duration] = readouts(room({ endedAt: undefined }));
    expect(duration).toBe('Not recorded');
  });

  it('runs to the last departure when everyone left without the owner ending it', () => {
    const base = room({ endedAt: undefined });
    const [duration] = readouts({
      ...base,
      participants: [
        { ...base.participants[0]!, leftAt: '2026-10-26T09:20:00.000Z' },
        { ...base.participants[1]!, leftAt: '2026-10-26T09:30:00.000Z' },
      ],
    });
    expect(duration).toBe('30 min');
  });
});
