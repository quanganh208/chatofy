// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { en } from '@chatofy/i18n';
import type { TtsVoice } from '@/clients/api-client';
import type { VoiceScope } from './voice-scope-toggle';
import type { VoiceCatalogState } from '@/hooks/use-voice-catalog';
import { VoicePicker } from './voice-picker';
import { LocaleProvider } from '@/i18n/provider';

/**
 * The three answers a catalog can give, which this control has to keep apart.
 *
 * A backend with no voices and a backend that could not be reached both come out
 * as "nothing to choose from"; showing the same thing for both is how a stopped
 * sidecar hides behind a feature that looks like it is working.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLElement;

const voice = (token: string, label: string, gender: TtsVoice['gender']): TtsVoice => ({
  token,
  label,
  gender,
});

function render(catalog: VoiceCatalogState, value = '', scope: VoiceScope = 'female'): void {
  act(() => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <VoicePicker
          catalog={catalog}
          scope={scope}
          // Which of the two defaults is the current one.
          gender={scope === 'all' ? 'female' : scope}
          value={value}
          onChange={() => {}}
        />
      </LocaleProvider>,
    );
  });
}

const trigger = () => container.querySelector('[data-slot="select-trigger"]');

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

describe('VoicePicker', () => {
  const catalog: VoiceCatalogState = {
    status: 'ready',
    voices: [voice('9', 'Sarah', 'female'), voice('11', 'Adam', 'male')],
  };

  it('shows the saved voice by name', () => {
    render(catalog, '11', 'male');
    expect(trigger()?.textContent).toContain('Adam');
  });

  it('holds the current default as a value, not as an empty field', () => {
    // The scope this opens in, with nothing named — the ordinary state. Shown
    // through `placeholder` it came out in `text-muted-foreground`, printing the
    // voice a conversation would be spoken in as though nothing were set.
    render(catalog, '', 'all');
    expect(trigger()?.textContent).toContain(en['web.translate.voiceDefault']);
    expect(trigger()?.textContent).toContain(en['web.translate.voiceFemale']);
    expect(trigger()?.hasAttribute('data-placeholder')).toBe(false);
  });

  it('offers nothing when this pool holds no voice', () => {
    // The list is scoped by the gender toggle above, so a backend with male
    // voices only leaves nothing to choose between on "female" — and a Select
    // whose one option is the state it is already in is not a choice.
    render({ status: 'ready', voices: [voice('11', 'Adam', 'male')] }, '', 'female');
    expect(container.textContent).toBe('');
  });

  it('names the absence of a choice rather than showing an empty field', () => {
    // The token leaves as `undefined`, but Radix reserves the empty string for a
    // Select holding nothing — so "no specific voice" needs a value of its own.
    render(catalog, '');
    expect(trigger()?.textContent).toContain(en['web.translate.voiceDefault']);
  });

  it('offers nothing when the backend offers no choice', () => {
    // A real answer: gender above is then the only voice control there is.
    render({ status: 'ready', voices: [] });
    expect(container.textContent).toBe('');
  });

  it('holds its place while the list is still being fetched', () => {
    // `loading` carries an empty list too. Read as "no voices", the whole control
    // vanished for the length of the request and then appeared under the pointer.
    render({ status: 'loading', voices: [] });
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(trigger()).toBeNull();
  });

  it('says so when the list could not be loaded', () => {
    render({ status: 'failed', voices: [] });
    expect(container.textContent).toContain(en['web.translate.voiceListFailed']);
    expect(trigger()).toBeNull();
  });
});
