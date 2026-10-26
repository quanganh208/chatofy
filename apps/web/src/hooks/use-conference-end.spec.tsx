// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@chatofy/api-client';
import type { ConferenceDetailResponse, ConferenceMinutes } from '@chatofy/types';
import { useConferenceEnd, type UseConferenceEnd } from './use-conference-end';

/**
 * What the end screen is told about a room: loaded, not one the caller was in,
 * or a read that failed — and what a generate does to the minutes on screen.
 */

const getConference = vi.hoisted(() => vi.fn());
const getConferenceMinutes = vi.hoisted(() => vi.fn());
const generateConferenceMinutes = vi.hoisted(() => vi.fn());
vi.mock('@/clients/api-client', () => ({
  getConference,
  getConferenceMinutes,
  generateConferenceMinutes,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOM = 'cl9ebqhxk00003b600tymydho';
const detail: ConferenceDetailResponse = {
  id: ROOM,
  status: 'ended',
  createdAt: '2026-10-26T09:00:00.000Z',
  ownerId: 'u-owner',
  participants: [],
  _count: { turns: 3 },
};
const minutes: ConferenceMinutes = {
  conferenceId: ROOM,
  status: 'ready',
  summary: 'They agreed.',
  keyPoints: [],
  decisions: [],
  actionItems: [],
  generatedAt: '2026-10-26T09:44:00.000Z',
  model: 'gemini-3.5-flash',
};

let container: HTMLDivElement;
let root: Root;
let latest: UseConferenceEnd;

function Probe() {
  const value = useConferenceEnd(ROOM);
  React.useEffect(() => {
    latest = value;
  });
  return null;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mount(): Promise<void> {
  act(() => {
    root.render(<Probe />);
  });
  await flush();
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('useConferenceEnd', () => {
  it('reads the room and its minutes together, with null as "none yet"', async () => {
    getConference.mockResolvedValue(detail);
    getConferenceMinutes.mockResolvedValue({ minutes: null });

    await mount();

    expect(latest.load).toBe('ready');
    expect(latest.conference).toEqual(detail);
    expect(latest.minutes).toBeNull();
  });

  it('reads a 404 as a room the caller was not in, not as a failure', async () => {
    getConference.mockRejectedValue(
      new ApiClientError({ code: 'NOT_FOUND', message: 'Conference not found' }, 404),
    );
    getConferenceMinutes.mockResolvedValue({ minutes: null });

    await mount();

    expect(latest.load).toBe('not-found');
  });

  it('reports any other read failure as failed', async () => {
    getConference.mockResolvedValue(detail);
    getConferenceMinutes.mockRejectedValue(new Error('network'));

    await mount();

    expect(latest.load).toBe('failed');
  });

  it('puts generated minutes on screen, in the language asked for', async () => {
    getConference.mockResolvedValue(detail);
    getConferenceMinutes.mockResolvedValue({ minutes: null });
    generateConferenceMinutes.mockResolvedValue({ minutes });
    await mount();

    await act(() => latest.generate('vi'));

    expect(generateConferenceMinutes).toHaveBeenCalledWith(ROOM, 'vi');
    expect(latest.minutes).toEqual(minutes);
    expect(latest.generating).toBe(false);
    expect(latest.generateFailed).toBe(false);
  });

  it('keeps the minutes already on screen when a regenerate fails', async () => {
    getConference.mockResolvedValue(detail);
    getConferenceMinutes.mockResolvedValue({ minutes });
    generateConferenceMinutes.mockRejectedValue(new Error('503'));
    await mount();

    await act(() => latest.generate('en'));

    expect(latest.generateFailed).toBe(true);
    expect(latest.minutes).toEqual(minutes);
    expect(latest.generating).toBe(false);
  });
});
