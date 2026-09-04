// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The claim this page must not make.
 *
 * Signing out here discards this browser's cookie. The API token it carried stays valid
 * until it expires, and other devices are untouched — the only thing that revokes
 * earlier tokens and closes open sockets is a completed password reset. So "sign out of
 * all devices" would be a security claim the system does not implement, on the page
 * where a user goes specifically to find out what their options are.
 *
 * The ban below is on the phrasing rather than on any one string, because the failure
 * arrives as a copy edit that sounded stronger, not as a code change.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const me = vi.fn(() =>
  Promise.resolve({
    id: 'u1',
    email: 'a@b.co',
    name: 'Quang Anh',
    createdAt: '2026-01-09T00:00:00.000Z',
  }),
);
vi.mock('@/clients/api-client', () => ({ getMe: () => me() }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { name: 'Quang Anh', email: 'a@b.co' } },
    status: 'authenticated',
  }),
  signOut: vi.fn(),
}));

const { AccountScreen } = await import('@/components/account/account-screen');
const { LocaleProvider } = await import('@/i18n/provider');

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <AccountScreen />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
}

describe('the account page', () => {
  it('never claims sign-out-everywhere', async () => {
    await render();
    const text = container.textContent ?? '';

    expect(text.length, 'the page rendered nothing at all').toBeGreaterThan(50);
    expect(text).not.toMatch(/all (?:your )?devices|everywhere|every device|all sessions/i);
    // The accurate version is present, not merely the wrong one absent.
    expect(text).toContain('this browser only');
  });

  it('shows identity from the session before the profile lands', async () => {
    await render();
    expect(container.textContent).toContain('a@b.co');
    expect(container.textContent).toContain('Quang Anh');
  });

  it('survives a profile lookup that fails, without signing anyone out', async () => {
    me.mockReturnValue(Promise.reject(new Error('401')));
    await render();

    // The session is still what the cookie says. Reporting the failure is this page's
    // job; acting on a 401 belongs to `use-auth-recovery.ts`, which the socket and HTTP
    // paths already run.
    expect(container.textContent).toContain('a@b.co');
    expect(container.textContent).toContain('Could not load your account details');
  });
});
