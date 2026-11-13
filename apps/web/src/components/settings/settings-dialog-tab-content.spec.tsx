// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';

/**
 * The Translation tab over a page whose conversation is running.
 *
 * The dialog opens over `/translate` mid-conversation. The pair, voice and context
 * ride `client.session.start`, so the tab must freeze them exactly as the page's own
 * popover does — everything but volume — and say why once. Display and microphone
 * never reach the running session and stay live.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const listVoices = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const listTranslationContexts = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock('@/clients/api-client', () => ({
  listVoices: () => listVoices(),
  listTranslationContexts: () => listTranslationContexts(),
}));

const { SettingsTabContent } = await import('./settings-dialog-tab-content');
const { useReportConversationRunning } = await import('@/hooks/use-conversation-running');
const { LocaleProvider } = await import('@/i18n/provider');

/** Stands in for the translate page: reports its conversation as running or not. */
function Page({ running }: { running: boolean }) {
  useReportConversationRunning(running);
  return null;
}

let root: Root;
let container: HTMLElement;

async function render(running: boolean) {
  await act(async () => {
    root.render(
      <LocaleProvider>
        <Page running={running} />
        <SettingsTabContent tab="translation" />
      </LocaleProvider>,
    );
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  localStorage.clear();
  listVoices.mockResolvedValue({ voices: [] });
  listTranslationContexts.mockResolvedValue({ contexts: [] });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const lockNote = () => container.querySelector('[data-settings-locked]');
const pairControls = () =>
  [...container.querySelectorAll<HTMLButtonElement>('[data-slot="select-trigger"]')].filter(
    (el) => !el.closest('[data-voice-language]'),
  );
const voiceSwitches = () => [
  ...container.querySelectorAll<HTMLButtonElement>('[data-voice-language] [role=switch]'),
];
const micSwitches = () =>
  Object.values({
    echo: en['common.audio.echoCancellation'],
    noise: en['common.audio.noiseSuppression'],
    gain: en['common.audio.autoGainControl'],
  }).map((name) =>
    container.querySelector<HTMLButtonElement>(`[role=switch][aria-label="${name}"]`),
  );

describe('Settings › Translation while a conversation runs', () => {
  it('names its groups', async () => {
    await render(false);
    const headings = [
      ...container.querySelectorAll('[data-slot="settings-section"] > div > h3'),
    ].map((h) => h.textContent);
    expect(headings).toEqual([
      en['web.settings.groupLanguages'],
      en['web.settings.groupVoice'],
      en['web.settings.groupDisplay'],
      en['web.settings.groupMicrophone'],
    ]);
  });

  it('folds every voice but the one-way target, and says on each fold whether it is spoken', async () => {
    await render(false);
    // Default pair is Vietnamese → English: English's voice is the open one.
    const open = [...container.querySelectorAll<HTMLElement>('[data-voice-language]')].map(
      (el) => el.dataset.voiceLanguage,
    );
    expect(open).toEqual(['en']);
    const triggers = container.querySelectorAll('[data-slot="accordion-trigger"]');
    expect(triggers).toHaveLength(3);
    for (const trigger of triggers)
      expect(trigger.textContent).toContain(`${en['web.translate.speakTranslation']}: `);
  });

  it('leaves everything live, with no note, while nothing runs', async () => {
    await render(false);
    expect(lockNote()).toBeNull();
    expect(pairControls().length).toBeGreaterThanOrEqual(4);
    for (const control of pairControls()) expect(control.disabled).toBe(false);
    for (const toggle of voiceSwitches()) expect(toggle.disabled).toBe(false);
  });

  it('freezes the pairs and voices, keeps volume, display and microphone live, and says why once', async () => {
    // An account with a context, so the context picker is on screen and frozen too.
    listTranslationContexts.mockResolvedValue({
      contexts: [
        {
          id: 'ctx-1',
          name: 'Thesis defense',
          topic: null,
          hotwords: [],
          glossary: [],
          style: null,
          glossaryId: null,
          linkedGlossaryId: null,
          linkedGlossaryName: null,
          updatedAt: '2026-09-17T00:00:00.000Z',
        },
      ],
    });
    await render(true);

    expect(lockNote()?.textContent).toBe(en['web.settings.lockedWhileRunning']);
    expect(container.querySelectorAll('[data-settings-locked]')).toHaveLength(1);
    // Said once for the tab, not again under each open voice.
    expect(container.textContent).not.toContain(en['web.translate.speakLocked']);
    expect(container.textContent).not.toContain(en['web.translate.contextLocked']);
    // Nothing stored reads None on the trigger, so it is found by its group.
    const context = [...container.querySelectorAll('[data-slot="settings-section"]')]
      .find(
        (section) =>
          section.querySelector('h3')?.textContent === en['web.settings.groupDefaultContext'],
      )
      ?.querySelector<HTMLButtonElement>('[data-slot="select-trigger"]');
    expect(context?.disabled).toBe(true);

    expect(pairControls().length).toBeGreaterThanOrEqual(4);
    for (const control of pairControls()) expect(control.disabled).toBe(true);
    for (const swap of container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Swap"]'))
      expect(swap.disabled).toBe(true);

    expect(voiceSwitches().length).toBeGreaterThan(0);
    for (const toggle of voiceSwitches()) expect(toggle.disabled).toBe(true);
    // Volume reaches the gain stage live, so it is the one voice control left open.
    const volumes = container.querySelectorAll('[data-voice-language] [role=slider]');
    expect(volumes.length).toBeGreaterThan(0);
    for (const volume of volumes) expect(volume.hasAttribute('data-disabled')).toBe(false);

    for (const toggle of micSwitches()) expect(toggle?.disabled).toBe(false);
    const speakerLabels = container.querySelector<HTMLButtonElement>(
      `[role=switch][aria-label="${en['web.translate.speakerLabels']}"]`,
    );
    expect(speakerLabels?.disabled).toBe(false);
  });

  it('unfreezes when the conversation ends', async () => {
    await render(true);
    await render(false);
    expect(lockNote()).toBeNull();
    for (const control of pairControls()) expect(control.disabled).toBe(false);
  });
});
