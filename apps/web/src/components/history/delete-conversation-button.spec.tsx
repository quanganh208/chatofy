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

function click(label: string): void {
  const button = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(label),
  );
  if (!button) throw new Error(`no button reading "${label}"`);
  act(() => button.click());
}

describe('DeleteConversationButton', () => {
  it('deletes nothing on the first press', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(onConfirm);

    click('Delete');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(container.textContent).toContain('This cannot be undone');
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
