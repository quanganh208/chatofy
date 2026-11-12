// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Autosave confirmations: one toast per setting, and Undo back to where the reader
 * started, not one step back.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Toast = { id?: string; undo?: () => void };
const notify = vi.hoisted(() => ({
  success: vi.fn<(message: string, options?: Toast) => void>(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify }));

const { useSettingSaver, SETTING_BURST_MS } = await import('./use-setting-saver');
const { LocaleProvider } = await import('@/i18n/provider');

interface Store {
  speed: number;
  voices: { en: string; vi: string };
}

let store: Store;
const apply = vi.fn((patch: Partial<Store>) => {
  store = { ...store, ...patch };
});
type Save = ReturnType<typeof useSettingSaver<Store>>;
let save: Save;
const expose = (next: Save) => {
  save = next;
};

function Probe({ onSaver }: { onSaver: (next: Save) => void }) {
  const saver = useSettingSaver<Store>(apply, () => store);
  useEffect(() => onSaver(saver), [onSaver, saver]);
  return null;
}

let root: Root;
let container: HTMLElement;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  store = { speed: 1, voices: { en: 'a', vi: 'b' } };
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => {
    root.render(
      <LocaleProvider>
        <Probe onSaver={expose} />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

const lastToast = () => notify.success.mock.calls.at(-1)!;

describe('useSettingSaver', () => {
  it('applies the patch and confirms with a toast named for the setting', () => {
    save('speed', 'Speed', { speed: 1.5 });
    expect(store.speed).toBe(1.5);
    expect(lastToast()[0]).toBe('Speed saved');
    expect(lastToast()[1]?.id).toBe('setting-speed');
  });

  it('keeps one toast id per setting through a drag, and undoes to before the drag', () => {
    save('speed', 'Speed', { speed: 1.25 });
    save('speed', 'Speed', { speed: 1.5 });
    save('speed', 'Speed', { speed: 1.75 });
    const ids = new Set(notify.success.mock.calls.map(([, options]) => options?.id));
    expect(ids).toEqual(new Set(['setting-speed']));

    lastToast()[1]?.undo?.();
    expect(store.speed).toBe(1);
  });

  it('starts a new burst once the setting has been left alone', () => {
    save('speed', 'Speed', { speed: 1.5 });
    vi.advanceTimersByTime(SETTING_BURST_MS + 1);
    save('speed', 'Speed', { speed: 2 });
    lastToast()[1]?.undo?.();
    expect(store.speed).toBe(1.5);
  });

  it('undoes a nested setting without touching siblings changed since', () => {
    const restoreEn = (before: Store, now: Store) => ({
      voices: { ...now.voices, en: before.voices.en },
    });
    save('voice-en', 'English voice', { voices: { ...store.voices, en: 'x' } }, restoreEn);
    const undoEn = lastToast()[1]?.undo;
    save('voice-vi', 'Vietnamese voice', { voices: { ...store.voices, vi: 'y' } });

    undoEn?.();
    expect(store.voices).toEqual({ en: 'a', vi: 'y' });
  });

  it('says nothing for a patch that changes nothing', () => {
    save('pair', 'Pair', {});
    expect(apply).not.toHaveBeenCalled();
    expect(notify.success).not.toHaveBeenCalled();
  });
});
