// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// No dictionary import: the one message asserted here is the API's own, which passes
// through in English — see `auth-error-message.ts` on why those have no code.
import { ApiClientError } from '@chatofy/api-client';

const resetPassword = vi.fn<(body: unknown) => Promise<{ message: string }>>();
const push = vi.fn<(href: string) => void>();
let search = new URLSearchParams();

vi.mock('@/clients/api-client', () => ({
  resetPassword: (body: unknown) => resetPassword(body),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => search,
}));

const { ResetPasswordForm } = await import('./reset-password-form');
const { LocaleProvider } = await import('@/i18n/provider');

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  window.history.pushState(null, '', '/reset-password?token=tok_abc');
  search = new URLSearchParams('token=tok_abc');
  resetPassword.mockReset();
  push.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

function render() {
  act(() => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <ResetPasswordForm />
      </LocaleProvider>,
    );
  });
}

const inputById = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;

// Plain `input.value = x` does not reach a CONTROLLED input's React state —
// React overrides the DOM node's own `value` setter to track changes, so a
// direct assignment is invisible to it. Going through the native setter first
// is the standard workaround.
function setValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(
    input,
    value,
  );
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function submit(password: string) {
  await act(async () => {
    setValue(inputById('reset-password'), password);
    await Promise.resolve();
  });
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
  });
}

describe('ResetPasswordForm', () => {
  it('strips the token out of the URL bar on mount', () => {
    render();
    expect(window.location.search).toBe('');
    // The token still reached the form — it was read into state before the
    // strip, not lost along with the query string.
    expect(container.querySelector('#reset-submit')).not.toBeNull();
  });

  it('renders an alert instead of a form when the link carries no token', () => {
    window.history.pushState(null, '', '/reset-password');
    search = new URLSearchParams();
    render();

    expect(container.querySelector('#reset-submit')).toBeNull();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      'missing its reset code',
    );
  });

  it('posts the token and password, then moves to /login?reset=1', async () => {
    render();
    resetPassword.mockResolvedValueOnce({ message: 'Your password has been changed.' });
    await submit('correct horse battery staple');

    expect(resetPassword).toHaveBeenCalledWith({
      token: 'tok_abc',
      password: 'correct horse battery staple',
    });
    expect(push).toHaveBeenCalledWith('/login?reset=1');
  });

  it('renders the API error message on a bad or expired link', async () => {
    render();
    resetPassword.mockRejectedValueOnce(
      new ApiClientError(
        { code: 'UNAUTHORIZED', message: 'That link is invalid or has expired' },
        401,
      ),
    );
    await submit('correct horse battery staple');

    const error = container.querySelector('#reset-error')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toBe('That link is invalid or has expired');
    expect(push).not.toHaveBeenCalled();
  });
});
