// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/i18n/provider';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOM = 'cl9ebqhxk00003b600tymydho';
const push = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
// A box rather than a `let`: `vi.mock` factories are hoisted above declarations.
const url = vi.hoisted(() => ({ query: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(url.query),
}));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'An Nguyen' } }, status: 'authenticated' }),
}));
const createConference = vi.hoisted(() => vi.fn<() => Promise<{ id: string }>>());
vi.mock('@/clients/api-client', () => ({ createConference: () => createConference() }));
const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn<(message: string, options?: { id?: string; retry?: () => void }) => void>(),
  info: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify }));

const { default: ConferenceLobbyPage } = await import('./page');

describe('ConferenceLobbyPage — the landing', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    push.mockClear();
    replace.mockClear();
    createConference.mockReset();
    notify.error.mockClear();
    notify.dismiss.mockClear();
    url.query = '';
    sessionStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = () =>
    act(() => {
      root.render(
        <LocaleProvider>
          <ConferenceLobbyPage />
        </LocaleProvider>,
      );
    });

  const flush = () =>
    act(async () => {
      for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    });

  /** The dialog portals to `document.body`, so it is looked up there. */
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

  async function openJoinDialog() {
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-join-by-code]')!.click();
      await Promise.resolve();
    });
  }

  /** Type into the code field and submit its form, the way the browser would. */
  async function joinWith(text: string) {
    await openJoinDialog();
    await act(async () => {
      const input = document.querySelector<HTMLInputElement>('#conf-room')!;
      // Through the prototype's setter: React tracks the value an assignment on
      // the element writes, and would treat the input event as no change.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      dialog()!
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
  }

  it('says which account the user joins as, and asks for no name', () => {
    render();
    expect(container.textContent).toContain('Joining as An Nguyen');
    expect(container.querySelector('#conf-name')).toBeNull();
  });

  it('joins the room a pasted invite link names', async () => {
    render();
    await joinWith(`https://chatofy.example/conference/${ROOM}`);
    expect(push).toHaveBeenCalledWith(`/conference/${ROOM}`);
  });

  it('keeps the code field out of the page until Join with a code is pressed', async () => {
    render();
    expect(document.querySelector('#conf-room')).toBeNull();
    await openJoinDialog();
    expect(dialog()?.querySelector('#conf-room')).not.toBeNull();
  });

  it('refuses a code that cannot name a room inline, and keeps the dialog open', async () => {
    render();
    await joinWith('hello');
    const input = document.querySelector<HTMLInputElement>('#conf-room')!;
    expect(input.value).toBe('hello');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const alert = dialog()?.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('That is not a meeting code or invite link.');
    expect(input.getAttribute('aria-describedby')).toBe(alert?.id);
    expect(push).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('clears the error once the reader edits the code', async () => {
    render();
    await joinWith('hello');
    await act(async () => {
      const input = document.querySelector<HTMLInputElement>('#conf-room')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'h');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    expect(dialog()?.querySelector('[role="alert"]')).toBeNull();
  });

  it('spends the one accent on the dialog Join while the dialog is open', async () => {
    render();
    const newMeeting = container.querySelector<HTMLButtonElement>('[data-new-meeting]')!;
    expect(newMeeting.dataset.variant).toBe('default');
    await openJoinDialog();
    expect(newMeeting.dataset.variant).toBe('outline');
    expect(document.querySelectorAll('button.bg-primary')).toHaveLength(1);
    expect(dialog()?.querySelector('button[type="submit"].bg-primary')).not.toBeNull();
  });

  it('opens a new meeting on its bare room URL', async () => {
    createConference.mockResolvedValue({ id: ROOM });
    render();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-new-meeting]')!.click();
    });
    await flush();
    expect(push).toHaveBeenCalledWith(`/conference/${ROOM}`);
  });

  it('toasts a failed create with a Retry that tries again', async () => {
    createConference.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ id: ROOM });
    render();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-new-meeting]')!.click();
    });
    await flush();
    expect(push).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledTimes(1);
    const [message, options] = notify.error.mock.calls[0]!;
    expect(message).toBe('Could not start a meeting');
    expect(options?.id).toBe('conference-create-failed');
    // The button is usable again, so the reader is never stuck behind a spinner.
    expect(container.querySelector<HTMLButtonElement>('[data-new-meeting]')!.disabled).toBe(false);

    act(() => {
      options?.retry?.();
    });
    await flush();
    expect(createConference).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledWith(`/conference/${ROOM}`);
  });

  it('draws no card', () => {
    render();
    expect(document.querySelector('[data-slot="card"]')).toBeNull();
  });

  it('heads the page with the task in the UI face, leaving the name to the breadcrumb', () => {
    render();
    const heading = container.querySelector('h2')!;
    expect(heading.textContent).toBe('Start or join a meeting');
    expect(heading.classList.contains('font-display')).toBe(false);
  });

  it('sends an old ?room= link straight to the room', () => {
    url.query = `room=${ROOM}`;
    render();
    expect(replace).toHaveBeenCalledWith(`/conference/${ROOM}`);
  });
});
