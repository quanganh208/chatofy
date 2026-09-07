// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteConversationButton } from './delete-conversation-button';
import { LocaleProvider } from '@/i18n/provider';

/**
 * The two-step, and what a failed delete says. The caller navigates away when
 * the delete works, so a button that just re-enables itself in silence is
 * indistinguishable from one that succeeded.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function render(onConfirm: () => Promise<void>) {
  act(() => {
    root.render(
      <LocaleProvider>
        <DeleteConversationButton onConfirm={onConfirm} />
      </LocaleProvider>,
    );
  });
}

function buttonNamed(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
}

function click(label: string): void {
  const button = buttonNamed(label);
  if (!button) throw new Error(`no button reading "${label}"`);
  act(() => button.click());
}

describe('DeleteConversationButton', () => {
  it('deletes nothing on the first press', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(onConfirm);

    click('Delete');

    expect(onConfirm).not.toHaveBeenCalled();
    // The step it opens instead: a second press, and a way out of it. The
    // consequence sentence is the delete zone's, not this component's — see
    // `conversation-detail.spec.tsx`, which holds it on screen from the start.
    expect(container.textContent).toContain('Cancel');
  });

  it('puts focus on the way out of the step it opens, not on the irreversible press', () => {
    // The first press unmounts the button it was made on, so focus fell to
    // `<body>` — the top of the document, above the whole sidebar, and before
    // the confirmation the reader is now looking at.
    //
    // Cancel rather than Delete: the press that opens this step is as often a
    // keyboard Enter as a click, and a key held a beat too long repeats. Focus
    // on the destructive button would let one keystroke take both steps.
    render(vi.fn().mockResolvedValue(undefined));

    click('Delete');

    expect(document.activeElement).toBe(buttonNamed('Cancel'));
  });

  it('puts focus back on the delete button when the confirmation is dismissed', () => {
    // The same drop in the other direction: Cancel unmounts itself.
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(onConfirm);

    click('Delete');
    click('Cancel');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(buttonNamed('Delete'));
  });

  it('says so when the delete fails, and lets it be pressed again', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('offline'));
    render(onConfirm);

    click('Delete');
    await act(async () => {
      click('Delete');
      await Promise.resolve();
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Could not delete this conversation');
    const confirm = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Delete'),
    );
    expect(confirm?.disabled).toBe(false);
  });

  it('speaks the failure rather than only showing it', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('offline'));
    render(onConfirm);

    click('Delete');
    // Opening the confirmation announces nothing: nothing has gone wrong yet.
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await act(async () => {
      click('Delete');
      await Promise.resolve();
    });

    // Inserted as its own node, which is what makes it spoken — swapping the
    // sentence into the paragraph already on screen announces nothing.
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Could not delete this conversation');
  });

  it('stays quiet when the delete works, because the caller navigates away', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(onConfirm);

    click('Delete');
    await act(async () => {
      click('Delete');
      await Promise.resolve();
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('Could not delete this conversation');
  });
});
