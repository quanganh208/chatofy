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

const { default: ConferenceLobbyPage } = await import('./page');

describe('ConferenceLobbyPage — the landing', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    push.mockClear();
    replace.mockClear();
    createConference.mockReset();
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

  /** Type into the code field and submit its form, the way the browser would. */
  async function joinWith(text: string) {
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('#conf-room')!;
      // Through the prototype's setter: React tracks the value an assignment on
      // the element writes, and would treat the input event as no change.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      container
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

  it('refuses a code that cannot name a room', async () => {
    render();
    await joinWith('hello');
    expect(container.querySelector<HTMLInputElement>('#conf-room')!.value).toBe('hello');
    expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('opens a new meeting on its bare room URL', async () => {
    createConference.mockResolvedValue({ id: ROOM });
    render();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[data-variant="default"]')!.click();
      for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    });
    expect(push).toHaveBeenCalledWith(`/conference/${ROOM}`);
  });

  it('sends an old ?room= link straight to the room', () => {
    url.query = `room=${ROOM}`;
    render();
    expect(replace).toHaveBeenCalledWith(`/conference/${ROOM}`);
  });
});
