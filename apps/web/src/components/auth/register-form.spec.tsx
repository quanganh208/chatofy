// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthMessage } from '@chatofy/types';
// No dictionary import: every string this file asserts is minted by the API and
// passes through in English — see `auth-error-message.ts` on why those have no code.
import { ApiClientError } from '@chatofy/api-client';

const register = vi.fn<(body: unknown) => Promise<AuthMessage>>();

vi.mock('@/clients/api-client', () => ({
  register: (body: unknown) => register(body),
}));

const { RegisterForm } = await import('./register-form');
const { LocaleProvider } = await import('@/i18n/provider');

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  register.mockReset();
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
        <RegisterForm />
      </LocaleProvider>,
    );
  });
}

const inputById = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;

// Plain `input.value = x` does not reach a CONTROLLED input's React state:
// React overrides the DOM node's own `value` setter to track changes, and a
// direct assignment bypasses that override, so the following `input` event
// fires against a tracker that never saw the new value and is dropped as a
// no-op. Going through the native setter first is the standard workaround.
function setValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(
    input,
    value,
  );
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function submit() {
  await act(async () => {
    setValue(inputById('register-name'), 'Ada Lovelace');
    setValue(inputById('register-email'), 'ada@example.com');
    setValue(inputById('register-password'), 'correct horse battery staple');
    await Promise.resolve();
  });
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
  });
}

describe('RegisterForm', () => {
  it('shows a fixed confirmation on 202 and signs nobody in', async () => {
    render();
    register.mockResolvedValueOnce({
      code: 'REGISTRATION_ACCEPTED',
      message: 'whatever the API happens to say',
    });
    await submit();

    expect(register).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'correct horse battery staple',
      name: 'Ada Lovelace',
      // The language the verification mail is written in. It rides the request
      // because there is no row yet to store it on — the row is what redeeming that
      // mail's link creates.
      locale: 'en',
    });
    // The API answers a fresh and an already-registered address identically —
    // the confirmation is a fixed string, not the API's own message, so it
    // cannot vary even if a future response body did.
    const success = container.querySelector('#register-success')!;
    expect(success.getAttribute('role')).toBe('status');
    expect(success.textContent).toBe(
      'Check your email for a link to finish creating your account.',
    );
    expect(container.textContent).not.toContain('whatever the API happens to say');
    // No form left to submit a second time, and nothing that looks like a
    // signed-in state.
    expect(container.querySelector('form')).toBeNull();
  });

  it('renders the API error message and announces it', async () => {
    render();
    register.mockRejectedValueOnce(
      new ApiClientError({ code: 'VALIDATION_FAILED', message: 'Password is too short' }, 400),
    );
    await submit();

    const error = container.querySelector('#register-error')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toBe('Password is too short');
    // The form survives a failed submit — nothing was created.
    expect(container.querySelector('#register-submit')).not.toBeNull();
  });
});
