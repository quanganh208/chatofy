// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@chatofy/types';

/**
 * The detail screen's three states, its two tabs, and its delete.
 *
 * Loading and not-found used to render the same plain paragraph two branches
 * apart, so for the first frame a conversation that was gone looked exactly like
 * one that was arriving. Delete lives in the header's `⋯` menu, and is still two
 * presses with the consequence on screen before the one that acts.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getConversation = vi.hoisted(() => vi.fn<() => Promise<{ conversation: Conversation }>>());
const deleteConversation = vi.hoisted(() => vi.fn<() => Promise<void>>());
const push = vi.hoisted(() => vi.fn());
vi.mock('@/clients/api-client', () => ({
  getConversation: () => getConversation(),
  deleteConversation: () => deleteConversation(),
}));

const useMinutes = vi.hoisted(() =>
  vi.fn(() => ({ minutes: null, loading: false, error: false, generate: vi.fn() })),
);
vi.mock('@/hooks/use-minutes', () => ({ useMinutes: () => useMinutes() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const { ConversationDetail } = await import('./conversation-detail');
const { LocaleProvider } = await import('@/i18n/provider');

const conversation: Conversation = {
  conversationId: 'c-1',
  languages: ['vi', 'en'],
  startedAt: '2026-09-03T10:00:00.000Z',
  endedAt: '2026-09-03T10:11:00.000Z',
  turnCount: 15,
  preview: 'xin chào',
  hasMinutes: false,
  pausedMs: 0,
  title: null,
  kind: 'one-way',
  speakerCount: 0,
  speakers: [],
  turns: [
    {
      position: 0,
      speakerRole: 'speaker_a',
      speakerLabel: null,
      sourceText: 'xin chào',
      displayText: null,
      sourceLanguages: ['vi'],
      translations: { en: 'hello' },
      offsetMs: null,
    },
  ],
  // No recording on the default fixture, so the screen renders exactly as it did
  // before this feature existed. Cases that want the bar override it.
  hasRecording: false,
  audioOffsetMs: null,
  audioDurationMs: null,
};

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.clearAllMocks();
});

async function mount(): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <ConversationDetail conversationId="c-1" />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
}

function buttonNamed(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === text);
}

function tab(name: string): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((el) =>
    el.textContent?.startsWith(name),
  );
}

/** The quiet first step: open `⋯` (Radix opens on pointerdown) and choose Delete. */
async function chooseDelete(): Promise<void> {
  const more = container.querySelector<HTMLElement>('button[aria-label="More actions"]');
  await act(async () => {
    more?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    await Promise.resolve();
  });
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) =>
    el.textContent?.includes('Delete'),
  );
  expect(item, 'the menu never opened').toBeDefined();
  await act(async () => {
    item?.click();
    // The strip opens once the menu has CLOSED, which Radix reports from a timeout
    // after its exit — so this waits out real time rather than a microtask.
    for (let i = 0; i < 10 && !container.querySelector('[role="alertdialog"]'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });
  expect(container.querySelector('[role="alertdialog"]'), 'the strip never opened').not.toBeNull();
}

describe('ConversationDetail', () => {
  it('keeps delete in the actions menu, not on the page', async () => {
    getConversation.mockResolvedValue({ conversation });
    await mount();

    expect(buttonNamed('Delete'), 'a delete button on the page').toBeUndefined();
    expect(container.querySelector('button[aria-label="More actions"]')).not.toBeNull();
  });

  it('states what deleting costs before the press that deletes', async () => {
    getConversation.mockResolvedValue({ conversation });
    await mount();
    await chooseDelete();

    // Choosing Delete in the menu is the quiet first press: nothing is gone yet,
    // the sentence is on screen, and focus waits on Cancel so a held key cannot
    // take both steps.
    expect(deleteConversation).not.toHaveBeenCalled();
    const strip = container.querySelector('[role="alertdialog"]');
    expect(strip?.textContent).toContain('This cannot be undone');
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  it('attaches the consequence to the confirmation and its control', async () => {
    getConversation.mockResolvedValue({ conversation });
    await mount();
    await chooseDelete();

    const strip = container.querySelector('[role="alertdialog"]');
    const remove = buttonNamed('Delete');
    for (const element of [strip, remove]) {
      const describedBy = element?.getAttribute('aria-describedby');
      expect(describedBy, 'announced with no consequence').toBeTruthy();
      expect(document.getElementById(describedBy!)?.textContent).toContain('This cannot be undone');
    }
  });

  it('puts focus back on the menu when the reader cancels', async () => {
    getConversation.mockResolvedValue({ conversation });
    await mount();
    await chooseDelete();

    act(() => buttonNamed('Cancel')?.click());
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('More actions');
  });

  it('deletes on the second press and goes back to the list', async () => {
    getConversation.mockResolvedValue({ conversation });
    deleteConversation.mockResolvedValue(undefined);
    await mount();
    await chooseDelete();

    await act(async () => {
      buttonNamed('Delete')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(deleteConversation).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/history');
  });

  it('keeps the confirmation open and says so when the delete is refused', async () => {
    getConversation.mockResolvedValue({ conversation });
    deleteConversation.mockRejectedValue(new Error('500'));
    await mount();
    await chooseDelete();

    await act(async () => {
      buttonNamed('Delete')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(push).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('still here');
  });

  it('opens on the transcript, on the page ground, with minutes one tab away', async () => {
    getConversation.mockResolvedValue({ conversation });
    await mount();

    const tabs = [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabs).toEqual(['Transcript', 'Minutes']);
    expect(container.textContent).toContain('hello');
    // No card anywhere on the transcript view — the minutes panel is the screen's
    // one surface, and it is not mounted until its tab is chosen.
    expect(container.querySelectorAll('[data-slot="card"]').length).toBe(0);

    await act(async () => {
      tab('Minutes')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      await Promise.resolve();
    });
    expect(tab('Minutes')?.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelectorAll('[data-slot="card"]').length).toBe(1);
    expect(container.textContent).toContain('Meeting minutes');
    expect(container.textContent).not.toContain('hello');
  });

  it('marks the Minutes tab when minutes exist, in words as well as a dot', async () => {
    getConversation.mockResolvedValue({ conversation: { ...conversation, hasMinutes: true } });
    await mount();
    expect(tab('Minutes')?.textContent).toContain('(ready)');

    act(() => root?.unmount());
    getConversation.mockResolvedValue({ conversation });
    await mount();
    expect(tab('Minutes')?.textContent).toBe('Minutes');
  });

  it('offers a way back to the list in the one-page layout', async () => {
    getConversation.mockResolvedValue({ conversation });
    await mount();
    const back = [...container.querySelectorAll('a')].find((a) =>
      a.textContent?.includes('Back to history'),
    );
    expect(back?.getAttribute('href')).toBe('/history');
  });

  it('names which conversation opened, so arriving from a row is confirmed', async () => {
    getConversation.mockResolvedValue({ conversation });
    await mount();

    expect(container.textContent).toContain('15 lines');
    expect(container.textContent).toContain('11 min');
    expect(container.textContent).toContain('One-way');
    expect(container.textContent).toContain('Vietnamese');
    expect(container.textContent).not.toMatch(/[→⇄]/);
  });

  it('heads the page with the topic title, or the first line until there is one', async () => {
    getConversation.mockResolvedValue({
      conversation: { ...conversation, title: 'Hợp đồng thuê nhà' },
    });
    await mount();
    expect(container.querySelector('header h2')?.textContent).toBe('Hợp đồng thuê nhà');

    act(() => root?.unmount());
    getConversation.mockResolvedValue({ conversation });
    await mount();
    expect(container.querySelector('header h2')?.textContent).toBe(conversation.preview);
  });

  it('does not draw a conversation that is still arriving as one that is gone', async () => {
    // Never settles, so the render under test is the loading frame.
    getConversation.mockReturnValue(new Promise(() => {}));
    await mount();

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Loading');
    expect(container.textContent).not.toContain('no longer here');
  });

  it('renders the recording bar for a conversation that has one', async () => {
    // The default fixture above has no recording, which is what the comment on
    // it promises a case here would override. Without this, `hasRecording:
    // true` was never exercised by this file at all.
    getConversation.mockResolvedValue({
      conversation: {
        ...conversation,
        hasRecording: true,
        audioOffsetMs: 1_400,
        audioDurationMs: 600_000,
      },
    });
    await mount();

    expect(container.querySelector('audio')).not.toBeNull();
    const play = [...container.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Play the recording',
    );
    expect(play).toBeDefined();
    expect(container.querySelector('[role="slider"]')).not.toBeNull();
  });

  it('draws a missing conversation as its own state, and offers no delete', async () => {
    getConversation.mockRejectedValue(new Error('404'));
    await mount();

    expect(container.textContent).toContain('no longer here');
    // The second line names what the screen can actually distinguish. The catch
    // swallows a transport failure too, so it must not claim the conversation was
    // deleted or the link was stale — those were only two of three.
    expect(container.textContent).toContain('could not reach the server');
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(0);
    expect(container.querySelector('button[aria-label="More actions"]')).toBeNull();
  });
});
