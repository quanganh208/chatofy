// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@chatofy/api-client';

const verifyEmail = vi.fn<(body: unknown) => Promise<{ message: string }>>();
const push = vi.fn<(href: string) => void>();
let search = new URLSearchParams();

vi.mock('@/clients/api-client', () => ({
  verifyEmail: (body: unknown) => verifyEmail(body),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => search,
}));

const { VerifyEmailClient } = await import('./verify-email-client');

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  window.history.pushState(null, '', '/verify-email?token=tok_reg');
  search = new URLSearchParams('token=tok_reg');
  verifyEmail.mockReset();
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
    root.render(<VerifyEmailClient />);
  });
}

async function clickVerify() {
  await act(async () => {
    container.querySelector<HTMLButtonElement>('#verify-submit')!.click();
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
  });
}

describe('VerifyEmailClient', () => {
  it('does not redeem the token merely from being mounted — only an explicit click does', () => {
    // A mail scanner's GET renders this component. Nothing in mounting it may
    // spend the token, or the scanner would burn the link before the person
    // who received it ever clicks it.
    render();
    expect(verifyEmail).not.toHaveBeenCalled();
  });

  it('strips the token out of the URL bar on mount', () => {
    render();
    expect(window.location.search).toBe('');
  });

  it('renders an alert instead of a button when the link carries no token', () => {
    window.history.pushState(null, '', '/verify-email');
    search = new URLSearchParams();
    render();

    expect(container.querySelector('#verify-submit')).toBeNull();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      'missing its verification code',
    );
  });

  it('redeems the token on click and moves to /login?verified=1 for a fresh account', async () => {
    render();
    verifyEmail.mockResolvedValueOnce({
      message: 'Your account is ready. Sign in to get started.',
    });
    await clickVerify();

    expect(verifyEmail).toHaveBeenCalledWith({ token: 'tok_reg' });
    expect(push).toHaveBeenCalledWith('/login?verified=1');
  });

  it('renders "already exists" as a notice, not an error, on a re-followed link', async () => {
    render();
    verifyEmail.mockResolvedValueOnce({
      message: 'That account already exists. Sign in to get started.',
    });
    await clickVerify();

    expect(push).not.toHaveBeenCalled();
    const notice = container.querySelector('#verify-already-exists')!;
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toContain('already exists');
    // The API's own message is not the account-existence oracle here — this
    // page just needs a way in, so a plain sign-in link is enough.
    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
  });

  it('renders a real refusal as an error, not the already-exists notice', async () => {
    render();
    verifyEmail.mockRejectedValueOnce(
      new ApiClientError(
        { code: 'UNAUTHORIZED', message: 'That link is invalid or has expired' },
        401,
      ),
    );
    await clickVerify();

    const error = container.querySelector('#verify-error')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toBe('That link is invalid or has expired');
    expect(container.querySelector('#verify-already-exists')).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});
