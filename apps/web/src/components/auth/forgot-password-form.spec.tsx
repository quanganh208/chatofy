// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@chatofy/api-client';

const forgotPassword = vi.fn<(body: unknown) => Promise<{ message: string }>>();

vi.mock('@/clients/api-client', () => ({
  forgotPassword: (body: unknown) => forgotPassword(body),
}));

const { ForgotPasswordForm } = await import('./forgot-password-form');

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  forgotPassword.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

function render() {
  act(() => {
    root = createRoot(container);
    root.render(<ForgotPasswordForm />);
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

async function submit(email: string) {
  await act(async () => {
    setValue(inputById('forgot-email'), email);
    await Promise.resolve();
  });
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
  });
}

describe('ForgotPasswordForm', () => {
  it('shows the same confirmation whether or not the address has an account', async () => {
    render();
    forgotPassword.mockResolvedValueOnce({ message: 'this text must not be rendered' });
    await submit('known@example.com');

    const success = container.querySelector('#forgot-success')!;
    expect(success.getAttribute('role')).toBe('status');
    expect(success.textContent).toBe('If that email has an account, a reset link is on its way.');
    // The API's own message is never read — the text is fixed regardless.
    expect(container.textContent).not.toContain('this text must not be rendered');
  });

  it('renders the API error message when the request genuinely fails', async () => {
    render();
    forgotPassword.mockRejectedValueOnce(
      new ApiClientError({ code: 'RATE_LIMITED', message: 'Too many requests' }, 429),
    );
    await submit('someone@example.com');

    const error = container.querySelector('#forgot-error')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toBe('Too many requests');
  });
});
