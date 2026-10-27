// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRANSLATE_SETTINGS_STORAGE_KEY } from '@/lib/translate-settings';
import { LocaleProvider } from '@/i18n/provider';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'An Nguyen' } }, status: 'authenticated' }),
}));

const { PreJoinStage } = await import('./pre-join-stage');

/** The voice gender the speaker leg would read from storage when it is built. */
function storedGender(): unknown {
  const raw = localStorage.getItem(TRANSLATE_SETTINGS_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as { voiceGender?: unknown }).voiceGender : undefined;
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
    // Past the settings hook's save debounce, so storage already says "male"
    // before Join — the save on Join must not write an older copy over it.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(storedGender()).toBe('male');

    const joinNow = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Join now',
    )!;
    act(() => joinNow.click());

    expect(onJoin).toHaveBeenCalledOnce();
    expect(storedGender()).toBe('male');
  });
});
