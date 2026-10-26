// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseConferenceReturn } from '@/hooks/use-conference';
import { LocaleProvider } from '@/i18n/provider';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOM = 'cl9ebqhxk00003b600tymydho';
const replace = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  useParams: () => ({ roomId: 'cl9ebqhxk00003b600tymydho' }),
  useSearchParams: () => new URLSearchParams('name=Alice&lang=vi'),
}));
const useConference = vi.hoisted(() => vi.fn<() => UseConferenceReturn>());
vi.mock('@/hooks/use-conference', () => ({ useConference: () => useConference() }));

const { default: ConferenceRoomPage } = await import('./page');

function call(over: Partial<UseConferenceReturn> = {}): UseConferenceReturn {
  return {
    status: 'in-call',
    errorReason: undefined,
    localStream: null,
    peers: new Map(),
    mySocketId: 's-local',
    localMuted: false,
    localVideoEnabled: true,
    audioBlocked: false,
    localTranslating: false,
    reconnectAttempt: 0,
    reconnectCap: 3,
    join: vi.fn(() => Promise.resolve()),
    leave: vi.fn(),
    toggleMute: vi.fn(),
    toggleVideo: vi.fn(),
    resumeAudio: vi.fn(() => Promise.resolve()),
    messages: [],
    sendChat: vi.fn(),
    chatRefusal: null,
    ...over,
  };
}

const ended = { status: 'error', errorReason: 'room-ended' } as const;

describe('ConferenceRoomPage — a room that ended', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    replace.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = () =>
    act(() => {
      root.render(
        <LocaleProvider>
          <ConferenceRoomPage />
        </LocaleProvider>,
      );
    });

  it('sends someone who was in the call to the end screen when the owner ends it', () => {
    useConference.mockReturnValue(call());
    render();
    useConference.mockReturnValue(call(ended));
    render();
    expect(replace).toHaveBeenCalledWith(`/conference/${ROOM}/ended`);
  });

  it('tells a visitor on an old link that the meeting ended, without an end screen', () => {
    useConference.mockReturnValue(call({ ...ended }));
    render();
    expect(replace).not.toHaveBeenCalledWith(`/conference/${ROOM}/ended`);
    expect(container.textContent).toContain('This meeting has ended');
  });
});
