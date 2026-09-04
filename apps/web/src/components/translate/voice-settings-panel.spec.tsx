// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';
import type { TranslateSettings } from '@/lib/translate-settings';

/**
 * The headphones advice, and the condition that is the whole reason it moved.
 *
 * It used to be a permanent row on the deleted hub's readiness card, shown to
 * everyone including people who had turned playback off. It now sits with the
 * speak-aloud switch, because that switch is what creates the problem it warns
 * about: the cascade path keeps the microphone open through playback, so the
 * translation is audible to it.
 *
 * That conditionality is exactly the kind of thing a later refactor drops
 * silently — the hint would either vanish or go back to being unconditional, and
 * neither shows up as a failure anywhere else.
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
  it('advises headphones while the translation is spoken aloud', async () => {
    await render({ voiceOutput: true });
    expect(container.textContent).toContain(en['web.translate.headphonesHint']);
  });

  it('says nothing about headphones when nothing is spoken', async () => {
    // Silence is the point. Advice about playback, given to someone who turned
    // playback off, is what the hub did.
    await render({ voiceOutput: false });
    expect(container.textContent).not.toContain(en['web.translate.headphonesHint']);
  });

  it('labels the gender control and the voice control differently', async () => {
    // Both read `web.translate.voice` once and printed the same word over two
    // adjacent controls.
    await render({ voiceOutput: true });
    expect(container.textContent).toContain(en['web.translate.voiceGender']);
    expect(en['web.translate.voiceGender']).not.toBe(en['web.translate.voice']);
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
