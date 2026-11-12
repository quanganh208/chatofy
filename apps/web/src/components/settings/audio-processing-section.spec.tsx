// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';
import { LocaleProvider } from '@/i18n/provider';
import { DEFAULT_TRANSLATE_SETTINGS } from '@/lib/translate-settings';
import { AudioProcessingSection, resetBrowserSupportForTests } from './audio-processing-section';

const notify = vi.hoisted(() => ({
  success: vi.fn<(message: string, options?: { id?: string; undo?: () => void }) => void>(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify }));

let container: HTMLDivElement;
let root: Root;

async function mount(set = vi.fn()) {
  await act(async () => {
    root.render(
      <LocaleProvider>
        <AudioProcessingSection
          settings={DEFAULT_TRANSLATE_SETTINGS}
          ready
          set={set}
          current={() => DEFAULT_TRANSLATE_SETTINGS}
        />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
  return set;
}

const switchFor = (label: string): HTMLButtonElement =>
  container.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`)!;

function supportConstraints(supported: MediaTrackSupportedConstraints | undefined) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: supported ? { getSupportedConstraints: () => supported } : undefined,
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  supportConstraints(undefined);
  resetBrowserSupportForTests();
});

afterEach(() => {
  notify.success.mockClear();
  act(() => root.unmount());
  container.remove();
});

describe('AudioProcessingSection', () => {
  it('draws three switches, all on by default, and the headphone recommendation', async () => {
    await mount();
    const switches = container.querySelectorAll('[role="switch"]');
    expect(switches).toHaveLength(3);
    for (const control of switches) expect(control.getAttribute('aria-checked')).toBe('true');
    expect(container.textContent).toContain(en['common.audio.recommendation']);
  });

  it('says on the echo cancellation row that meeting peers hear the echo', async () => {
    await mount();
    expect(container.textContent).toContain(en['web.preferences.audio.conferenceNote']);
  });

  it('turns echo cancellation off without touching the other two', async () => {
    const set = await mount();
    act(() => {
      switchFor(en['common.audio.echoCancellation']).click();
    });
    expect(set).toHaveBeenCalledWith({
      micProcessing: { echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    });
  });

  it('confirms the change with a toast whose undo restores only that switch', async () => {
    const set = await mount();
    act(() => {
      switchFor(en['common.audio.noiseSuppression']).click();
    });
    expect(notify.success).toHaveBeenCalledTimes(1);
    const [message, options] = notify.success.mock.calls[0]!;
    expect(message).toBe(`${en['common.audio.noiseSuppression']} saved`);
    expect(options?.id).toBe('setting-noiseSuppression');

    set.mockClear();
    act(() => options?.undo?.());
    expect(set).toHaveBeenCalledWith({
      micProcessing: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  });

  it('disables a processor the browser says it cannot honour, and says why', async () => {
    // Left out, as a browser does: an unsupported constraint is absent, never `false`.
    supportConstraints({ echoCancellation: true, noiseSuppression: true });
    await mount();
    expect(switchFor(en['common.audio.autoGainControl']).disabled).toBe(true);
    expect(switchFor(en['common.audio.echoCancellation']).disabled).toBe(false);
    expect(container.textContent).toContain(en['web.preferences.audio.unsupported']);
  });
});
