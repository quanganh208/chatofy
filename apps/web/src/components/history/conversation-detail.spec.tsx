// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@chatofy/types';

/**
 * The detail screen's three states, and the one thing that moved between them.
 *
 * Loading and not-found used to render the same plain paragraph two branches
 * apart, so for the first frame a conversation that was gone looked exactly like
 * one that was arriving. And delete used to sit second on the screen, opposite
 * "back", above the transcript the reader opened the page for.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getConversation = vi.hoisted(() => vi.fn<() => Promise<{ conversation: Conversation }>>());
const deleteConversation = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock('@/clients/api-client', () => ({
  getConversation: () => getConversation(),
  deleteConversation: () => deleteConversation(),
}));

vi.mock('@/hooks/use-minutes', () => ({
  useMinutes: () => ({ minutes: null, loading: false, error: false, generate: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const { ConversationDetail } = await import('./conversation-detail');
const { LocaleProvider } = await import('@/i18n/provider');

const conversation: Conversation = {
  conversationId: 'c-1',
  direction: 'vi_to_en',
  startedAt: '2026-09-03T10:00:00.000Z',
  endedAt: '2026-09-03T10:11:00.000Z',
  turnCount: 15,
  preview: 'xin chào',
  hasMinutes: false,
  turns: [
    {
      position: 0,
      speakerRole: 'speaker_a',
      speakerLabel: null,
      sourceText: 'xin chào',
      displayText: null,
      targetText: 'hello',
    },
  ],
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

describe('ConversationDetail', () => {
  it('states what deleting costs before anything is pressed', async () => {
    // The sentence used to arrive WITH the confirming button, which is a warning
    // shown only to someone who has already decided to look at it. It now lives
    // in the delete zone, so it is on screen from the first paint.
    getConversation.mockResolvedValue({ conversation });
    await mount();

    expect(container.textContent).toContain('This cannot be undone');
    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons.some((label) => label?.includes('Cancel'))).toBe(false);
  });

  it('puts delete after every record it destroys', async () => {
    getConversation.mockResolvedValue({ conversation });
    await mount();

    // The LAST card, not the first. Anchored on the transcript alone, a delete
    // sitting between the transcript and the minutes passes — which is the one
    // placement this assertion exists to rule out, since the minutes go with the
    // conversation.
    const cards = [...container.querySelectorAll('[data-slot="card"]')];
    expect(cards.length, 'transcript and minutes').toBe(2);
    const remove = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Delete'),
    );
    expect(remove).toBeDefined();
    expect(cards.at(-1)!.compareDocumentPosition(remove!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('attaches the consequence to the control, not only to the layout', async () => {
    getConversation.mockResolvedValue({ conversation });
    await mount();

    const remove = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Delete'),
    );
    const describedBy = remove?.getAttribute('aria-describedby');
    expect(describedBy, 'delete announces itself with no consequence').toBeTruthy();
    expect(container.querySelector(`#${describedBy}`)?.textContent).toContain(
      'This cannot be undone',
    );
  });

  it('names which conversation opened, so arriving from a row is confirmed', async () => {
    getConversation.mockResolvedValue({ conversation });
    await mount();

    expect(container.textContent).toContain('15 lines');
    expect(container.textContent).toContain('11 min');
    expect(container.textContent).toContain('VI → EN');
  });

  it('does not draw a conversation that is still arriving as one that is gone', async () => {
    // Never settles, so the render under test is the loading frame.
    getConversation.mockReturnValue(new Promise(() => {}));
    await mount();

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Loading');
    expect(container.textContent).not.toContain('no longer here');
  });

  it('draws a missing conversation as its own state, and offers no delete', async () => {
    getConversation.mockRejectedValue(new Error('404'));
    await mount();

    expect(container.textContent).toContain('no longer here');
    // The second line names the two ways to arrive here — the API answers a
    // foreign id and an absent one identically, so the screen says both.
    expect(container.textContent).toContain('out of date');
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(0);
    const remove = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Delete'),
    );
    expect(remove).toBeUndefined();
  });
});
