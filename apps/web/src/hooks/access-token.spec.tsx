// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The regression these cover, in one sentence: `useSession()` answers
 * `{ data: undefined, status: 'loading' }` on the first client render, and both
 * translate hooks build their transport exactly once — so a token read as a
 * VALUE is captured empty and never updated, every socket dials with no
 * credential, and the recovery path then signs a perfectly valid session out.
 *
 * Neither hook can list the token in a dependency array: one is a
 * `sessionRef.current ??=`, the other a `useCallback` that would tear down a
 * live conversation if it were rebuilt. So reading late is the fix, and these
 * assert exactly that.
 */

const session: { data: unknown; status: string } = { data: undefined, status: 'loading' };
const signOut = vi.fn<(options: { redirectTo: string }) => Promise<void>>();
/**
 * What `useSession().update()` resolves to — the session AFTER a renewal was
 * attempted on a writable path. Recovery is driven entirely by this, which is
 * why the probe's 401 is no longer the end of the story.
 */
let afterUpdate: unknown = null;

vi.mock('next-auth/react', () => ({
  useSession: () => ({ ...session, update: () => Promise.resolve(afterUpdate) }),
  signOut: (options: { redirectTo: string }) => signOut(options),
}));

const { useAccessToken } = await import('./use-access-token');
const { useAuthRecovery } = await import('./use-auth-recovery');

let root: Root | undefined;
let container: HTMLElement;

/** Mount a hook and hand back whatever it returned, plus a re-render trigger. */
function mountHook<T>(hook: () => T): { value: () => T; rerender: () => void } {
  let latest: T;
  function Probe() {
    latest = hook();
    return null;
  }
  act(() => {
    root = createRoot(container);
    root.render(<Probe />);
  });
  return {
    value: () => latest,
    // Re-rendered WITHOUT a changing key: a new key would remount, giving fresh
    // refs and a fresh useMemo — which is precisely the state these tests must
    // not have, since the bug is about surviving a re-render.
    rerender: () => act(() => root!.render(<Probe />)),
  };
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  session.data = undefined;
  session.status = 'loading';
  afterUpdate = null;
  signOut.mockReset();
  vi.restoreAllMocks();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

describe('useAccessToken', () => {
  it('reports the token that exists NOW, not the one that existed at mount', () => {
    const probe = mountHook(() => useAccessToken());
    const reader = probe.value();

    // First render: the provider has not answered yet.
    expect(reader.current()).toBe('');
    expect(reader.isLoading()).toBe(true);

    session.data = { accessToken: 'the.real.token' };
    session.status = 'authenticated';
    probe.rerender();

    // The SAME reader object — the one a transport captured at construction —
    // now answers with the resolved token. A plain value would still be ''.
    expect(reader.current()).toBe('the.real.token');
    expect(reader.isLoading()).toBe(false);
  });

  it('hands back a stable object, so capturing it in a closure is safe', () => {
    const probe = mountHook(() => useAccessToken());
    const first = probe.value();
    session.status = 'authenticated';
    session.data = { accessToken: 'x' };
    probe.rerender();
    expect(probe.value()).toBe(first);
  });

  it('separates signed out from not answered yet', () => {
    session.status = 'unauthenticated';
    session.data = null;
    const reader = mountHook(() => useAccessToken()).value();
    expect(reader.current()).toBe('');
    expect(reader.isLoading()).toBe(false);
  });
});

describe('useAuthRecovery', () => {
  const recoveryFor = (reader: ReturnType<typeof useAccessToken>) =>
    mountHook(() => useAuthRecovery(reader)).value();

  it('does NOT sign out while the session is still hydrating', async () => {
    // The failure this replaces: a transport hiccup during the first paint used
    // to eject a valid user to /login.
    const reader = { current: () => '', isLoading: () => true };
    const handled = await recoveryFor(reader).handleConnectionFailure();

    expect(handled).toBe(false);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('signs out when the session has resolved and there is no token', async () => {
    // Nothing to renew, so this one still signs out directly.
    const reader = { current: () => '', isLoading: () => false };
    expect(await recoveryFor(reader).handleConnectionFailure()).toBe(true);
    expect(signOut).toHaveBeenCalledWith({ redirectTo: '/login' });
  });

  it('renews rather than signing out when the probe 401s but the session lives', async () => {
    // The whole point of the change: a 401 usually means the access token aged
    // out, not that the session is over. Signing out here is the bug — the user
    // is mid-conversation and the credential is renewable.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 401 } as Response);
    afterUpdate = { accessToken: 'renewed.token' };
    const reader = { current: () => 'stale.token', isLoading: () => false };

    expect(await recoveryFor(reader).handleConnectionFailure()).toBe(false);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('signs out when the renewal is terminally refused', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 401 } as Response);
    afterUpdate = { accessToken: 'stale.token', error: 'RefreshTokenError' };
    const reader = { current: () => 'stale.token', isLoading: () => false };

    expect(await recoveryFor(reader).handleConnectionFailure()).toBe(true);
    expect(signOut).toHaveBeenCalled();
  });

  it('does NOT sign out when the renewal came back with the same token', async () => {
    // A 429 or a 5xx leaves the token untouched, so recovery reports transient.
    // Reporting success here would retry the identical expired token forever —
    // a user fully "signed in" on an app where every request fails.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 401 } as Response);
    afterUpdate = { accessToken: 'stale.token' };
    const reader = { current: () => 'stale.token', isLoading: () => false };

    expect(await recoveryFor(reader).handleConnectionFailure()).toBe(false);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('retries rather than signing out when the token is still good', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200 } as Response);
    const reader = { current: () => 'good.token', isLoading: () => false };
    expect(await recoveryFor(reader).handleConnectionFailure()).toBe(false);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('treats an unreachable probe as the network, never as an auth failure', async () => {
    // Signing out here would log people out over a flaky connection.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const reader = { current: () => 'good.token', isLoading: () => false };
    expect(await recoveryFor(reader).handleConnectionFailure()).toBe(false);
    expect(signOut).not.toHaveBeenCalled();
  });
});
