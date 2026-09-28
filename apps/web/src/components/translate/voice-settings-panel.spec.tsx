// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';
import type { TranslateSettings } from '@/lib/translate-settings';

/**
 * Two adjacent controls that both want to be called "voice".
 *
 * The gender toggle and the voice catalog sit one above the other, and both read
 * naturally as the voice setting. They printed the same word for a release
 * because both reached for `web.translate.voice`, which no type check and no
 * render can catch — a duplicated label is a working screen that cannot be read.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const listVoices = vi.hoisted(() => vi.fn<() => Promise<{ voices: unknown[] }>>());
vi.mock('@/clients/api-client', () => ({ listVoices: () => listVoices() }));

const { VoiceSettingsPanel } = await import('./voice-settings-panel');
const { LocaleProvider } = await import('@/i18n/provider');
const { DEFAULT_TRANSLATE_SETTINGS } = await import('@/lib/translate-settings');

let root: Root | undefined;
let container: HTMLElement;

async function render(overrides: Partial<TranslateSettings> = {}): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <VoiceSettingsPanel
          settings={{ ...DEFAULT_TRANSLATE_SETTINGS, ...overrides }}
          running={false}
          onChange={vi.fn()}
          onVolumeChange={vi.fn()}
        />
      </LocaleProvider>,
    );
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  listVoices.mockResolvedValue({ voices: [] });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.clearAllMocks();
});

describe('VoiceSettingsPanel', () => {
  it('labels the gender control and the voice control differently', async () => {
    // Both read `web.translate.voice` once and printed the same word over two
    // adjacent controls.
    await render({ voiceOutput: true });
    expect(container.textContent).toContain(en['web.translate.voiceGender']);
    expect(en['web.translate.voiceGender']).not.toBe(en['web.translate.voice']);
  });
});

/**
 * `speedAdjustable` is an ENGINE fact from the catalog, not a fact derived from
 * direction — a lesson this component's own history already paid for once (see
 * the removed `RATE_ADJUSTABLE` table this replaced).
 *
 * Each case mocks `useVoiceCatalog` directly and imports a fresh copy of the
 * component, rather than driving it through `listVoices` like the rest of this
 * file: the hook caches its answer by output language for the whole tab (see
 * `use-voice-catalog.ts`), and both cases here want the SAME language with a
 * different answer — a plain `listVoices` mock would only ever exercise
 * whichever value happened to be cached first.
 */
describe('the rate control', () => {
  async function textWithCatalog(speedAdjustable: boolean): Promise<string | null> {
    vi.resetModules();
    vi.doMock('@/hooks/use-voice-catalog', () => ({
      useVoiceCatalog: () => ({ status: 'ready', voices: [], speedAdjustable }),
    }));
    const { VoiceSettingsPanel: FreshPanel } = await import('./voice-settings-panel');
    const { LocaleProvider: FreshLocaleProvider } = await import('@/i18n/provider');
    const { DEFAULT_TRANSLATE_SETTINGS: freshDefaults } = await import('@/lib/translate-settings');

    const el = document.createElement('div');
    document.body.appendChild(el);
    const freshRoot = createRoot(el);
    await act(async () => {
      freshRoot.render(
        <FreshLocaleProvider>
          <FreshPanel
            settings={{ ...freshDefaults, voiceOutput: true }}
            running={false}
            onChange={vi.fn()}
            onVolumeChange={vi.fn()}
          />
        </FreshLocaleProvider>,
      );
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    const text = el.textContent;
    act(() => freshRoot.unmount());
    el.remove();
    vi.doUnmock('@/hooks/use-voice-catalog');
    return text;
  }

  it('shows once the catalog says this engine honours speed', async () => {
    expect(await textWithCatalog(true)).toContain(en['web.translate.speed']);
  });

  it('is absent while the catalog says this engine ignores speed', async () => {
    expect(await textWithCatalog(false)).not.toContain(en['web.translate.speed']);
  });
});

/**
 * The rule the arrangement got wrong for a release: volume is the loudness of
 * something being spoken, so with nothing spoken there is nothing to set.
 *
 * It escaped the switch by sitting below a separator with the transcript layout,
 * under a comment grouping the two as "client-side, so both stay live
 * mid-conversation" — which is true of both and relevant to neither. Being
 * ADJUSTABLE is not being MEANINGFUL, and that conflation is what left a slider
 * on screen setting the loudness of silence.
 */
describe('what is reachable with playback off', () => {
  const volume = () => container.querySelector('[aria-label="Playback volume"]');

  it('offers no volume when nothing is spoken', async () => {
    await render({ voiceOutput: false });
    expect(volume()).toBeNull();
  });

  it('offers it again as soon as something is', async () => {
    await render({ voiceOutput: true });
    expect(volume()).not.toBeNull();
  });

  it('leaves only the switch itself when playback is off', async () => {
    // Everything under the switch is about a voice that is not speaking. The
    // switch stays, because it is the way back.
    await render({ voiceOutput: false });
    const speak = container.querySelector('button[aria-label="Speak the translation aloud"]');
    expect(speak).not.toBeNull();
    expect(container.querySelectorAll('[role="radiogroup"]').length).toBe(0);
  });
});
