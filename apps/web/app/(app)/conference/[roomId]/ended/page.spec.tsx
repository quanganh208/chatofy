// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConferenceDetailResponse, ConferenceMinutes } from '@chatofy/types';
import { LocaleProvider } from '@/i18n/provider';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOM = 'cl9ebqhxk00003b600tymydho';
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ roomId: 'cl9ebqhxk00003b600tymydho' }),
}));

const getConference = vi.hoisted(() => vi.fn<() => Promise<ConferenceDetailResponse>>());
const getConferenceMinutes = vi.hoisted(() =>
  vi.fn<() => Promise<{ minutes: ConferenceMinutes | null }>>(),
);
const generateConferenceMinutes = vi.hoisted(() =>
  vi.fn<() => Promise<{ minutes: ConferenceMinutes }>>(),
);
vi.mock('@/clients/api-client', () => ({
  getConference: () => getConference(),
  getConferenceMinutes: () => getConferenceMinutes(),
  generateConferenceMinutes: () => generateConferenceMinutes(),
}));

const notify = vi.hoisted(() => ({
  success: vi.fn<(message: string, options?: { id?: string }) => void>(),
  error: vi.fn<(message: string, options?: { id?: string; retry?: () => void }) => void>(),
  info: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify }));

const { default: ConferenceEndedPage } = await import('./page');

const DETAIL: ConferenceDetailResponse = {
  id: ROOM,
  status: 'ended',
  createdAt: '2026-10-26T09:00:00.000Z',
  ownerId: 'u-owner',
  startedAt: '2026-10-26T09:00:00.000Z',
  endedAt: '2026-10-26T09:42:00.000Z',
  participants: [
    {
      id: 'p-1',
      userId: 'u-owner',
      displayName: 'Alice',
      sourceLanguage: 'vi',
      status: 'left',
      joinedAt: '2026-10-26T09:00:00.000Z',
    },
  ],
  _count: { turns: 3 },
};

const READY: ConferenceMinutes = {
  conferenceId: ROOM,
  status: 'ready',
  summary: 'They agreed.',
  keyPoints: ['A point.'],
  decisions: [],
  actionItems: [],
  generatedAt: '2026-10-26T09:45:00.000Z',
  model: 'test-model',
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  getConference.mockResolvedValue(DETAIL);
  getConferenceMinutes.mockResolvedValue({ minutes: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = () =>
  act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });

async function render() {
  act(() => {
    root.render(
      <LocaleProvider>
        <ConferenceEndedPage />
      </LocaleProvider>,
    );
  });
  await flush();
}

async function pressGenerate() {
  const button = Array.from(
    container.querySelectorAll<HTMLButtonElement>('[data-minutes-panel] button'),
  ).find((el) => el.textContent?.includes('Generate'));
  expect(button, 'no Generate button on the end screen').toBeDefined();
  act(() => {
    button!.click();
  });
  await flush();
}

describe('ConferenceEndedPage', () => {
  it('lays the summary and the minutes on the page ground, with no card', async () => {
    await render();
    const heading = container.querySelector('h2')!;
    expect(heading.textContent).toBe('Meeting ended');
    expect(heading.classList.contains('font-display')).toBe(false);
    expect(container.querySelector('dl')).not.toBeNull();
    expect(container.querySelector('[data-slot="card"]')).toBeNull();
    expect(container.querySelector('[data-minutes-panel]')).not.toBeNull();
  });

  it('says the minutes are ready once a pass the reader started lands', async () => {
    generateConferenceMinutes.mockResolvedValue({ minutes: READY });
    await render();
    await pressGenerate();
    expect(notify.success).toHaveBeenCalledWith('Minutes are ready', {
      id: 'conference-minutes',
    });
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('toasts a failed pass with a Retry that runs another', async () => {
    generateConferenceMinutes
      .mockRejectedValueOnce(new Error('model down'))
      .mockResolvedValueOnce({ minutes: READY });
    await render();
    await pressGenerate();
    expect(notify.error).toHaveBeenCalledTimes(1);
    const [message, options] = notify.error.mock.calls[0]!;
    expect(message).toBe('Could not generate the minutes');
    expect(options?.id).toBe('conference-minutes');

    act(() => {
      options?.retry?.();
    });
    await flush();
    expect(generateConferenceMinutes).toHaveBeenCalledTimes(2);
    expect(notify.success).toHaveBeenCalledTimes(1);
  });

  it('fires no toast for a failed record that was stored before the reader arrived', async () => {
    getConferenceMinutes.mockResolvedValue({ minutes: { ...READY, status: 'failed' } });
    await render();
    expect(notify.error).not.toHaveBeenCalled();
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('goes back to the lobby', async () => {
    await render();
    const back = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent === 'Back to lobby',
    );
    act(() => back!.click());
    expect(push).toHaveBeenCalledWith('/conference');
  });
});
