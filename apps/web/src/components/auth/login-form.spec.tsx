// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';

/**
 * What a restyle is allowed to change about this form: nothing.
 *
 * Phase 4 rewrote every element here — both fields became the shared `Input`,
 * the submit became full-width, the page around it gained a `Card`. Three
 * behaviours had to survive that and none of them is visible in a prop diff:
 *
 * 1. The failure message stays GENERIC. The API answers a wrong password and an
 *    unknown email identically on purpose; a form that said which one was wrong
 *    would turn the login page into an account-enumeration oracle. The string is
 *    a literal inside the submit handler, so it survives any prop-level
 *    comparison while a handler rewritten around it changes meaning.
 * 2. `type`, `required` and `autoComplete` reach the rendered inputs. These are
 *    what password managers read; losing them is silent, and the report is "it
 *    stopped filling", months later.
 * 3. `?next=` cannot leave the origin. `same-origin-path.spec.ts` covers the
 *    clamp itself — what this covers is that the form still calls it, which is
 *    the half a unit test of the helper cannot see.
 */

const signIn = vi.fn<(provider: string, options: unknown) => Promise<{ error?: string } | void>>();
const push = vi.fn<(href: string) => void>();
const refresh = vi.fn();
let search = new URLSearchParams();

vi.mock('next-auth/react', () => ({
  signIn: (provider: string, options: unknown) => signIn(provider, options),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => search,
}));

const { LoginForm } = await import('./login-form');
const { LocaleProvider } = await import('@/i18n/provider');

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  search = new URLSearchParams();
  signIn.mockReset();
  push.mockReset();
  refresh.mockReset();
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
        <LoginForm />
      </LocaleProvider>,
    );
  });
}

const inputById = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;

/** Fill both fields and submit, the way the browser would. */
async function submit() {
  await act(async () => {
    inputById('email').value = 'someone@example.com';
    inputById('email').dispatchEvent(new Event('input', { bubbles: true }));
    inputById('password').value = 'hunter2';
    inputById('password').dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    // The handler resolves `signIn` and then sets state; without draining the
    // queue the assertions read the tree mid-update.
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
  });
}

describe('LoginForm', () => {
  it('renders both fields with the attributes a password manager reads', () => {
    render();

    expect(inputById('email').type).toBe('email');
    expect(inputById('email').required).toBe(true);
    expect(inputById('email').autocomplete).toBe('username');

    expect(inputById('password').type).toBe('password');
    expect(inputById('password').required).toBe(true);
    expect(inputById('password').autocomplete).toBe('current-password');

    // Both are the shared primitive now, not a hand-rolled class string.
    expect(inputById('email').dataset.slot).toBe('input');
    expect(inputById('password').dataset.slot).toBe('input');
  });

  it('says the same thing whether the email is unknown or the password is wrong', async () => {
    render();

    const messages = new Set<string>();
    for (const error of ['CredentialsSignin', 'Unknown account', 'invalid_password']) {
      signIn.mockResolvedValueOnce({ error });
      await submit();
      messages.add(container.querySelector('#login-error')!.textContent ?? '');
    }

    // One message for every failure the API can report. Not "a message exists" —
    // that would pass while each branch said something different.
    expect(messages.size, [...messages].join(' | ')).toBe(1);
    const only = [...messages][0]!;
    expect(only).toBe(en['web.auth.credentialsRejected']);
    // And it must not name which half was wrong.
    expect(only.toLowerCase()).not.toMatch(/no account|not registered|incorrect password|unknown/);
  });

  it('announces the failure rather than only showing it', async () => {
    render();
    signIn.mockResolvedValueOnce({ error: 'CredentialsSignin' });
    await submit();
    expect(container.querySelector('#login-error')!.getAttribute('role')).toBe('alert');
  });

  it('marks both fields invalid, and never just one', async () => {
    // The message is already generic (above). The ARIA has to be generic too: a
    // form that flagged only the email would say which half was wrong in a
    // channel a screen reader reads out loud, rebuilding the enumeration oracle
    // the message avoids. Both fields, or neither.
    render();
    expect(inputById('email').getAttribute('aria-invalid')).toBeNull();
    expect(inputById('password').getAttribute('aria-invalid')).toBeNull();

    signIn.mockResolvedValueOnce({ error: 'CredentialsSignin' });
    await submit();

    for (const id of ['email', 'password']) {
      expect(inputById(id).getAttribute('aria-invalid'), id).toBe('true');
      expect(inputById(id).getAttribute('aria-describedby'), id).toBe('login-error');
    }
    // The description has to resolve, or the field points at nothing.
    expect(container.querySelector('#login-error')).not.toBeNull();
  });

  it('resumes where the gate turned the user away', async () => {
    search = new URLSearchParams('next=/sessions/8f3a');
    render();
    signIn.mockResolvedValueOnce({});
    await submit();

    // Refresh BEFORE navigating, or the pages behind the gate render from a
    // cache taken while the user was signed out.
    expect(refresh).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/sessions/8f3a');
  });

  it.each(['https://evil.example/', '//evil.example/', '/\\evil.example', 'javascript:alert(1)'])(
    'refuses to send a just-authenticated user to %s',
    async (next) => {
      search = new URLSearchParams();
      search.set('next', next);
      render();
      signIn.mockResolvedValueOnce({});
      await submit();

      expect(push).toHaveBeenCalledTimes(1);
      const destination = push.mock.calls[0]![0];
      expect(destination.startsWith('/')).toBe(true);
      expect(destination.startsWith('//')).toBe(false);
      expect(destination).not.toContain('evil.example');
    },
  );

  it('does not navigate at all when sign-in failed', async () => {
    render();
    signIn.mockResolvedValueOnce({ error: 'CredentialsSignin' });
    await submit();
    expect(push).not.toHaveBeenCalled();
  });
});
