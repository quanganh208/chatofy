// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';
import { LocaleProvider } from '@/i18n/provider';
import { DEFAULT_TRANSLATE_SETTINGS } from '@/lib/translate-settings';
import { AudioProcessingSection, resetBrowserSupportForTests } from './audio-processing-section';

let container: HTMLDivElement;
let root: Root;

async function mount(set = vi.fn()) {
  await act(async () => {
    root.render(
      <LocaleProvider>
        <AudioProcessingSection settings={DEFAULT_TRANSLATE_SETTINGS} ready set={set} />
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

  it('turns echo cancellation off without touching the other two', async () => {
    const set = await mount();
    act(() => {
      switchFor(en['common.audio.echoCancellation']).click();
    });
    expect(set).toHaveBeenCalledWith({
      micProcessing: { echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    });
  });

  it('disables a processor the browser says it cannot honour, and says why', async () => {
    supportConstraints({ echoCancellation: true, noiseSuppression: true, autoGainControl: false });
    await mount();
    expect(switchFor(en['common.audio.autoGainControl']).disabled).toBe(true);
    expect(switchFor(en['common.audio.echoCancellation']).disabled).toBe(false);
    expect(container.textContent).toContain(en['web.preferences.audio.unsupported']);
  });
});
