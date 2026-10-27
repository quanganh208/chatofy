// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseConferenceReturn } from '@/hooks/use-conference';
import { DEFAULT_TRANSLATE_SETTINGS } from '@/lib/translate-settings';
import { LocaleProvider } from '@/i18n/provider';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOM = 'cl9ebqhxk00003b600tymydho';
const replace = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  useParams: () => ({ roomId: 'cl9ebqhxk00003b600tymydho' }),
  // Ignored by the room since the pre-join screen: an old link's `?name=` must
  // neither join nor redirect.
  useSearchParams: () => new URLSearchParams('name=Alice&lang=vi'),
}));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'An Nguyen' } }, status: 'authenticated' }),
}));
vi.mock('@/hooks/use-translate-settings', () => ({
  useTranslateSettings: () => ({
    settings: DEFAULT_TRANSLATE_SETTINGS,
    ready: true,
    set: vi.fn(),
    current: () => DEFAULT_TRANSLATE_SETTINGS,
  }),
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
    translationEnded: false,
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

describe('ConferenceRoomPage — translation that ended mid-call', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (value: UseConferenceReturn) => {
    useConference.mockReturnValue(value);
    act(() => {
      root.render(
        <LocaleProvider>
          <ConferenceRoomPage />
        </LocaleProvider>,
      );
    });
  };

  it('says so in one quiet line while the call goes on', () => {
    render(call({ translationEnded: true }));
    const notice = container.querySelectorAll('[data-translation-ended]');
    expect(notice).toHaveLength(1);
    expect(notice[0]!.textContent).toContain('Translation stopped');
    expect(notice[0]!.querySelector('button')).toBeNull();
  });

  it('shows nothing while translation runs', () => {
    render(call());
    expect(container.querySelector('[data-translation-ended]')).toBeNull();
  });
});

describe('ConferenceRoomPage — the pre-join screen', () => {
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

  const render = (value: UseConferenceReturn) => {
    useConference.mockReturnValue(value);
    act(() => {
      root.render(
        <LocaleProvider>
          <ConferenceRoomPage />
        </LocaleProvider>,
      );
    });
  };
  const idle = () => call({ status: 'idle', mySocketId: null });
  const nameInput = () => container.querySelector<HTMLInputElement>('#conf-name')!;
  const joinNow = () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Join now')!;

  it('asks before joining, with the account name already filled in', () => {
    render(idle());
    expect(container.textContent).toContain('Ready to join?');
    expect(nameInput().value).toBe('An Nguyen');
  });

  it('stays on the room URL, whatever an old link carried', () => {
    render(idle());
    expect(replace).not.toHaveBeenCalled();
  });

  it('joins with the name and language chosen here', () => {
    const value = idle();
    render(value);
    act(() => joinNow().click());
    expect(value.join).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'An Nguyen', sourceLanguage: 'vi' }),
    );
  });

  it('will not join without a name', () => {
    render(idle());
    act(() => {
      // Through the prototype's setter: React tracks the value an assignment on
      // the element writes, and would treat the input event as no change.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        nameInput(),
        '',
      );
      nameInput().dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(joinNow().disabled).toBe(true);
  });

  it('names the voice others will hear the translation in', () => {
    render(idle());
    const chip = container.querySelector('[data-conference-voice-chip]');
    expect(chip?.textContent).toContain('Female');
    expect(chip?.textContent).toContain('1×');
  });
});
