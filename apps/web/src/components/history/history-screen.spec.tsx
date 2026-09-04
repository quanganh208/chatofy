// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The search field, and the one state where it is not offered.
 *
 * An account with nothing stored cannot be searched, so the field says so by not
 * accepting a term — a live box there answers every word identically. The trap
 * is the state next door: a search that MATCHED nothing is also a screen with
 * zero rows, and disabling the field there would lock a reader inside their own
 * query with no way to type out of it.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const listConversations = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock('@/clients/api-client', () => ({ listConversations: () => listConversations() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/history',
  useSearchParams: () => new URLSearchParams(),
}));

const { HistoryScreen } = await import('./history-screen');
const { LocaleProvider } = await import('@/i18n/provider');

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
        <HistoryScreen />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
}

function field(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('#history-search');
  if (!input) throw new Error('no search field');
  return input;
}

function type(value: string): void {
  const input = field();
  act(() => {
    // `HTMLInputElement.value` is a setter on the prototype, and React's own
    // tracker reads the last value it wrote — assigning directly makes React
    // treat the change as a no-op. Setting through the prototype descriptor is
    // what makes the event carry a new value.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('HistoryScreen', () => {
  it('does not offer a search over an account with nothing in it', async () => {
    listConversations.mockResolvedValue({ conversations: [], nextCursor: null });
    await mount();
    expect(field().disabled).toBe(true);
  });

  it('keeps the field live when a search matched nothing', async () => {
    // Zero rows, same as above — and the field must stay usable, or the only way
    // out of a bad query is the browser's own undo.
    listConversations.mockResolvedValue({ conversations: [], nextCursor: null });
    await mount();

    type('hoá đơn');

    expect(field().disabled).toBe(false);
  });

  it('offers the search once there is something to search', async () => {
    listConversations.mockResolvedValue({
      conversations: [
        {
          conversationId: 'c-1',
          direction: 'vi_to_en',
          startedAt: '2026-09-03T10:00:00.000Z',
          endedAt: '2026-09-03T10:10:00.000Z',
          turnCount: 4,
          preview: 'xin chào',
          hasMinutes: false,
        },
      ],
      nextCursor: null,
    });
    await mount();

    expect(field().disabled).toBe(false);
  });
});
