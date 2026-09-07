// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';
import { ApiClientError } from '@chatofy/api-client';

const forgotPassword = vi.fn<(body: unknown) => Promise<{ message: string }>>();

vi.mock('@/clients/api-client', () => ({
  forgotPassword: (body: unknown) => forgotPassword(body),
}));

const { ForgotPasswordForm } = await import('./forgot-password-form');
const { LocaleProvider } = await import('@/i18n/provider');

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
    root.render(
      <LocaleProvider>
        <ForgotPasswordForm />
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
    expect(success.textContent).toBe(en['web.auth.resetLinkSent']);
    // The API's own message is never read — the text is fixed regardless.
    expect(container.textContent).not.toContain('this text must not be rendered');
  });

  it('has the confirmation region on screen before there is anything to confirm', async () => {
    // A live region has to exist BEFORE its content changes for assistive
    // technology to report the change — `auth-alert.tsx` records the rule for the
    // failure path. This branch used to create the paragraph in the same commit
    // that removed the form, which announces unreliably and drops focus to
    // `<body>` with it.
    render();
    const notice = container.querySelector('#forgot-success');
    expect(notice?.getAttribute('role')).toBe('status');
    expect(notice?.textContent).toBe('');

    forgotPassword.mockResolvedValueOnce({ message: 'ignored' });
    await submit('someone@example.com');

    // The same node, filled in — not a new one carrying the same id.
    expect(container.querySelector('#forgot-success')).toBe(notice);
    expect(document.activeElement).toBe(notice);
  });

  it('marks the field invalid and points it at the message', async () => {
    render();
    expect(inputById('forgot-email').getAttribute('aria-invalid')).toBeNull();

    forgotPassword.mockRejectedValueOnce(
      new ApiClientError({ code: 'RATE_LIMITED', message: 'Too many requests' }, 429),
    );
    await submit('someone@example.com');

    expect(inputById('forgot-email').getAttribute('aria-invalid')).toBe('true');
    expect(inputById('forgot-email').getAttribute('aria-describedby')).toBe('forgot-error');
    expect(container.querySelector('#forgot-error')).not.toBeNull();
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
