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
 * one that was arriving. The title and the actions are the topbar's — mounted here
 * in a host with the topbar's two slots. Delete lives in the topbar's `⋯` menu, and
 * is still two presses with the consequence on screen before the one that acts.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getConversation = vi.hoisted(() => vi.fn<() => Promise<{ conversation: Conversation }>>());
const deleteConversation = vi.hoisted(() => vi.fn<() => Promise<void>>());
const replace = vi.hoisted(() => vi.fn());
vi.mock('@/clients/api-client', () => ({
  getConversation: () => getConversation(),
  deleteConversation: () => deleteConversation(),
}));

const useMinutes = vi.hoisted(() =>
  vi.fn(() => ({ minutes: null, loading: false, error: false, generate: vi.fn() })),
);
vi.mock('@/hooks/use-minutes', () => ({ useMinutes: () => useMinutes() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

const { ConversationDetail } = await import('./conversation-detail');
const { ChromeSlotsTestHost } = await import('./chrome-slots-test-host');
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
        <ChromeSlotsTestHost>
          <ConversationDetail conversationId="c-1" />
        </ChromeSlotsTestHost>
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
}

/** By its visible text, over the document: dialogs portal to `document.body`. */
function buttonNamed(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((b) => b.textContent === text);
}

const dialog = () => document.querySelector('[role="alertdialog"]');

/** Real time for a step Radix finishes from a timeout or an animation end. */
async function settle(until: () => boolean): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20 && !until(); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });
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
  act(() => item?.click());
  // The dialog opens once the menu has CLOSED, which Radix reports from a timeout
  // after its exit — so this waits out real time rather than a microtask.
  await settle(() => dialog() !== null);
  expect(dialog(), 'the confirmation never opened').not.toBeNull();
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
    expect(dialog()?.textContent).toContain('This cannot be undone');
    expect(dialog()?.textContent).toContain('Delete “xin chào”?');
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  it('attaches the consequence to the confirmation', async () => {
    getConversation.mockResolvedValue({ conversation });
    await mount();
    await chooseDelete();

    const describedBy = dialog()?.getAttribute('aria-describedby');
    expect(describedBy, 'announced with no consequence').toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toContain('This cannot be undone');
  });

  it('puts focus back on the menu when the reader cancels', async () => {
    getConversation.mockResolvedValue({ conversation });
    await mount();
    await chooseDelete();

    act(() => buttonNamed('Cancel')?.click());
    await settle(
      () =>
        dialog() === null && document.activeElement?.getAttribute('aria-label') === 'More actions',
    );
    expect(dialog()).toBeNull();
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
    // Replaced, not pushed: Back must not lead to a conversation that is gone.
    expect(replace).toHaveBeenCalledWith('/history');
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
    expect(replace).not.toHaveBeenCalled();
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain('still here');
  });

  it('opens on the transcript, on the page ground, with minutes one tab away', async () => {
    getConversation.mockResolvedValue({ conversation });
    await mount();

    const tabs = [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabs).toEqual(['Transcript', 'Minutes']);
    expect(container.textContent).toContain('hello');
    // No card anywhere on the transcript view, and none on the Minutes tab either:
    // both panels are on the page ground.
    expect(container.querySelectorAll('[data-slot="card"]').length).toBe(0);

    await act(async () => {
      tab('Minutes')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      await Promise.resolve();
    });
    expect(tab('Minutes')?.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelectorAll('[data-slot="card"]').length).toBe(0);
    expect(container.querySelector('[role="tabpanel"] section')).not.toBeNull();
    expect(container.textContent).not.toContain('hello');
  });

  it('names the Minutes tab panel for assistive tech without repeating the title', async () => {
    getConversation.mockResolvedValue({ conversation });
    await mount();
    await act(async () => {
      tab('Minutes')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      await Promise.resolve();
    });

    // The selected tab already reads "Minutes"; a visible "Meeting minutes"
    // heading under it would say the same thing twice.
    const panel = container.querySelector('[role="tabpanel"][data-state="active"]');
    expect(panel?.textContent).not.toContain('Meeting minutes');
    expect(panel?.querySelector('h2, h3')).toBeNull();
    // The region still has a name, so a screen reader announces what it is.
    expect(panel?.querySelector('section')?.getAttribute('aria-label')).toBe('Meeting minutes');
    // Generate is still there, alone on its row.
    expect(panel?.querySelector('button')?.textContent).toBe('Generate minutes');
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

  it('names the topbar crumb with the topic title, or the first line until there is one', async () => {
    getConversation.mockResolvedValue({
      conversation: { ...conversation, title: 'Hợp đồng thuê nhà' },
    });
    await mount();
    const crumb = () => container.querySelector('[data-slot="topbar-crumb"]')?.textContent;
    expect(crumb()).toBe('Hợp đồng thuê nhà');
    // The pane does not repeat it: the crumb is the screen's one heading.
    expect(container.querySelector('section h2')).toBeNull();
    expect(container.querySelector('section')?.getAttribute('aria-label')).toBe(
      'Hợp đồng thuê nhà',
    );

    act(() => root?.unmount());
    getConversation.mockResolvedValue({ conversation });
    await mount();
    expect(crumb()).toBe(conversation.preview);
  });

  it('puts Rename, Download and the menu in the topbar, not in the pane', async () => {
    getConversation.mockResolvedValue({ conversation });
    await mount();
    const topbar = container.querySelector('[data-slot="topbar-actions"]');
    expect(topbar?.querySelector('[data-action="rename"]')).not.toBeNull();
    expect(topbar?.querySelector('[data-action="download"]')).not.toBeNull();
    expect(topbar?.querySelector('button[aria-label="More actions"]')).not.toBeNull();
    expect(container.querySelector('section [data-action="rename"]')).toBeNull();
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
    // Nor a crumb naming something that is not there.
    expect(container.querySelector('[data-slot="topbar-crumb"]')?.textContent).toBe('');
  });
});
