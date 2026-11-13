// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIC_PROCESSING_STORAGE_KEY } from '@/lib/mic-processing-store';
import { currentPreferences } from '@/lib/preferences/active-preferences';
import { currentTranslateSettings } from '@/lib/translate-settings-preferences';
import { en } from '@chatofy/i18n';
import { LocaleProvider } from '@/i18n/provider';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'An Nguyen' } }, status: 'authenticated' }),
}));

const { PreJoinStage } = await import('./pre-join-stage');

/** The voice gender the speaker leg reads when it is built, on "Join". */
function legGender(): unknown {
  // The chip writes one gender into every language's setup; any language reads it.
  return currentTranslateSettings().voiceByLanguage.en.gender;
}

describe('PreJoinStage — the voice chosen here is the voice the call uses', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('keeps a voice changed well before Join is pressed', async () => {
    const onJoin = vi.fn();
    await act(async () => {
      root.render(
        <LocaleProvider>
          <PreJoinStage onJoin={onJoin} />
        </LocaleProvider>,
      );
      // The preview opens asynchronously and stores what it got (here nothing:
      // happy-dom has no camera); let that land inside this act.
      await Promise.resolve();
    });

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-conference-voice-chip]')!.click();
    });
    const male = [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find(
      (radio) => radio.textContent === 'Male',
    )!;
    act(() => male.click());
    // Past the store's save debounce, so the pick has settled before Join — and
    // Join must not put an older copy back over it.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(legGender()).toBe('male');

    const joinNow = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Join now',
    )!;
    act(() => joinNow.click());

    expect(onJoin).toHaveBeenCalledOnce();
    expect(legGender()).toBe('male');
    // The language joined in is remembered for the account's next meeting.
    expect(currentPreferences().conferenceLanguage).toBe('vi');
  });
});

describe('PreJoinStage — the meeting echo note', () => {
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

  async function mount() {
    await act(async () => {
      root.render(
        <LocaleProvider>
          <PreJoinStage onJoin={vi.fn()} />
        </LocaleProvider>,
      );
      await Promise.resolve();
    });
  }

  it('warns before joining that others will hear echo when echo cancellation is off', async () => {
    localStorage.setItem(MIC_PROCESSING_STORAGE_KEY, JSON.stringify({ echoCancellation: false }));
    await mount();
    expect(container.textContent).toContain(en['web.preferences.audio.conferenceNote']);
  });

  it('says nothing about echo with echo cancellation on', async () => {
    await mount();
    expect(container.textContent).not.toContain(en['web.preferences.audio.conferenceNote']);
  });
});
