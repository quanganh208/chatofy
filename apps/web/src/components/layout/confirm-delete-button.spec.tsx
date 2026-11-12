// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';
import { ConfirmDeleteButton } from './confirm-delete-button';
import { LocaleProvider } from '@/i18n/provider';

/**
 * The confirmation, and what a failed delete says. The caller navigates away when the
 * delete works, so a button that just re-enables itself in silence is indistinguishable
 * from one that succeeded.
 *
 * The dialog portals to `document.body`, so everything after the first press is looked
 * up inside `[role="alertdialog"]` — the trigger behind it reads the same word.
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

function render(
  onConfirm: () => Promise<void>,
  extra: Partial<Parameters<typeof ConfirmDeleteButton>[0]> = {},
) {
  act(() => {
    root.render(
      <LocaleProvider>
        <ConfirmDeleteButton
          {...extra}
          onConfirm={onConfirm}
          labels={{
            action: en['web.history.delete'],
            pending: en['web.history.deleting'],
            cancel: en['web.history.cancel'],
            failed: en['web.history.deleteFailed'],
          }}
        />
      </LocaleProvider>,
    );
  });
}

const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');

function dialogButton(label: string): HTMLButtonElement | undefined {
  return [...(dialog()?.querySelectorAll('button') ?? [])].find((b) =>
    b.textContent?.includes(label),
  );
}

function openDialog(): void {
  const trigger = container.querySelector('button');
  if (!trigger) throw new Error('no trigger');
  act(() => trigger.click());
}

async function pressDelete(): Promise<void> {
  await act(async () => {
    dialogButton('Delete')?.click();
    await Promise.resolve();
  });
}

describe('ConfirmDeleteButton', () => {
  it('deletes nothing on the first press, and asks in a dialog', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(onConfirm);

    openDialog();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
    expect(dialogButton('Cancel')).toBeDefined();
  });

  it('puts focus on the way out, not on the irreversible press', () => {
    // A held Enter repeats; focus on Delete would let one keystroke take both steps.
    render(vi.fn().mockResolvedValue(undefined));
    openDialog();
    expect(document.activeElement).toBe(dialogButton('Cancel'));
  });

  it('names what goes and what it costs', () => {
    render(vi.fn().mockResolvedValue(undefined), { name: 'Client call' });
    openDialog();

    expect(dialog()?.textContent).toContain('Delete “Client call”?');
    // With no caller sentence the dialog still says the cost, never a title alone.
    expect(dialog()?.textContent).toContain(en['web.chrome.confirmIrreversible']);
    expect(dialogButton('Delete')?.getAttribute('aria-label')).toBe('Delete Client call');
  });

  it("reads the caller's consequence sentence with the dialog", () => {
    const sentence = document.createElement('p');
    sentence.id = 'cost';
    sentence.textContent = 'The recording goes too.';
    document.body.append(sentence);
    render(vi.fn().mockResolvedValue(undefined), {
      describedBy: 'cost',
      description: 'Recording and minutes are deleted.',
    });
    openDialog();

    expect(dialog()?.getAttribute('aria-describedby')?.split(' ')).toContain('cost');
    expect(dialog()?.textContent).toContain('Recording and minutes are deleted.');
    sentence.remove();
  });

  it('puts focus back on the trigger when the reader cancels', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    render(onConfirm, { onCancel });

    openDialog();
    act(() => dialogButton('Cancel')?.click());
    // Radix hands focus back a task after the dialog unmounts.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('button'));
  });

  it('keeps the dialog open on failure, says so out loud, and focuses the retry', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('offline'));
    render(onConfirm);

    openDialog();
    // Opening announces nothing: nothing has gone wrong yet.
    expect(dialog()?.querySelector('[role="alert"]')).toBeNull();
    await pressDelete();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Inserted as its own node, which is what makes it spoken.
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not delete this conversation',
    );
    const retry = dialogButton('Delete');
    expect(retry?.disabled).toBe(false);
    expect(document.activeElement).toBe(retry);
  });

  it('closes quietly when the delete works', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(onConfirm);

    openDialog();
    await pressDelete();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    expect(document.body.textContent).not.toContain('Could not delete this conversation');
  });

  it('cannot be dismissed while the request is out', async () => {
    let finish: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(onConfirm);

    openDialog();
    await pressDelete();
    act(() => {
      dialog()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(dialog()).not.toBeNull();
    expect(dialogButton('Deleting')?.disabled).toBe(true);
    await act(() => {
      finish();
      return Promise.resolve();
    });
  });
});

describe('ConfirmDeleteButton, second step only', () => {
  it('draws Delete and Cancel in place with focus on Cancel, for a caller that drew the strip', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(onConfirm, { startConfirming: true, onCancel: vi.fn() });

    // No modal on top of the caller's own alertdialog strip.
    expect(dialog()).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  it('hands a cancel back to the caller', () => {
    const onCancel = vi.fn();
    render(vi.fn().mockResolvedValue(undefined), { startConfirming: true, onCancel });

    const cancel = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Cancel',
    );
    act(() => cancel?.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('says a failure out loud and returns focus to the retry', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('offline'));
    render(onConfirm, { startConfirming: true, onCancel: vi.fn() });

    const remove = () =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Delete');
    await act(async () => {
      remove()?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not delete this conversation',
    );
    expect(document.activeElement).toBe(remove());
  });
});
