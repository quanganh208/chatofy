// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';
import { ApiClientError } from '@chatofy/api-client';
import type { InvitePreviewResponse, TeamResponse } from '@chatofy/types';

/**
 * `/invite` takes the token out of the URL before anything else, never links with
 * it, and maps every refusal by its status rather than its English message.
 */
const TOKEN = 'T'.repeat(42) + '-';

const previewTeamInvite = vi.fn<(token: string) => Promise<InvitePreviewResponse>>();
const acceptTeamInvite = vi.fn<(token: string) => Promise<TeamResponse>>();
const signOut = vi.fn<(options: unknown) => Promise<void>>();
const session = { value: { data: null as unknown, status: 'unauthenticated' } };
let search = new URLSearchParams();

vi.mock('@/clients/api-client', () => ({ authedFetch: vi.fn() }));
vi.mock('@/clients/teams-api-client', async () => {
  const actual = await vi.importActual<typeof import('@/clients/teams-api-client')>(
    '@/clients/teams-api-client',
  );
  return {
    inviteRefusalStatus: actual.inviteRefusalStatus,
    previewTeamInvite: (token: string) => previewTeamInvite(token),
    acceptTeamInvite: (token: string) => acceptTeamInvite(token),
  };
});
vi.mock('next/navigation', () => ({ useSearchParams: () => search }));
vi.mock('next-auth/react', () => ({
  useSession: () => session.value,
  signOut: (options: unknown) => signOut(options),
}));

const { InviteAcceptClient } = await import('./invite-accept-client');
const { LocaleProvider } = await import('@/i18n/provider');
const { readPendingInvite } = await import('@/lib/pending-invite');

const SIGNED_IN = { data: { user: { id: 'u1' } }, status: 'authenticated' };
const PENDING: InvitePreviewResponse = {
  status: 'pending',
  teamName: 'Cardiology <b>unit</b>',
  role: 'member',
  inviterEmail: 'lead@example.com',
};
const TEAM: TeamResponse = {
  team: {
    id: 'c' + 'a'.repeat(24),
    name: 'Cardiology unit',
    role: 'member',
    memberCount: 2,
    createdAt: '2026-11-14T00:00:00.000Z',
  },
};

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  window.history.pushState(null, '', `/invite?token=${TOKEN}`);
  search = new URLSearchParams(`token=${TOKEN}`);
  session.value = SIGNED_IN;
  previewTeamInvite.mockReset();
  acceptTeamInvite.mockReset();
  signOut.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
});

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <InviteAcceptClient />
      </LocaleProvider>,
    );
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
  });
}

async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
  await act(async () => {
    button!.click();
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
  });
}

const text = () => container.textContent ?? '';
const buttonLabels = () => [...container.querySelectorAll('button')].map((b) => b.textContent);

describe('InviteAcceptClient', () => {
  it('moves the token out of the URL before any API call', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    previewTeamInvite.mockResolvedValue(PENDING);
    await render();

    expect(replaceState).toHaveBeenCalledWith(null, '', '/invite');
    expect(replaceState.mock.invocationCallOrder[0]).toBeLessThan(
      previewTeamInvite.mock.invocationCallOrder[0]!,
    );
    expect(window.location.search).toBe('');
    expect(readPendingInvite()).toBe(TOKEN);
  });

  it('offers sign-in and a new account, with no token in either link, when signed out', async () => {
    session.value = { data: null, status: 'unauthenticated' };
    await render();

    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/login?next=%2Finvite', '/register?next=%2Finvite']);
    expect(hrefs.some((href) => href?.includes('token='))).toBe(false);
    expect(previewTeamInvite).not.toHaveBeenCalled();
  });

  it('calls nothing for a malformed token', async () => {
    search = new URLSearchParams('token=short');
    await render();

    expect(text()).toContain(en['web.invite.invalid']);
    expect(previewTeamInvite).not.toHaveBeenCalled();
  });

  it('shows "not valid" for a malformed link even when an older invite is stored', async () => {
    const { savePendingInvite } = await import('@/lib/pending-invite');
    savePendingInvite('O'.repeat(43));
    search = new URLSearchParams('token=short');
    await render();

    expect(text()).toContain(en['web.invite.invalid']);
    expect(previewTeamInvite).not.toHaveBeenCalled();
  });

  it('offers sign-in, not a retry, when the session can no longer renew', async () => {
    session.value = {
      data: { user: { id: 'u1' }, error: 'RefreshFailed' },
      status: 'authenticated',
    };
    await render();

    expect(container.querySelector('a[href="/login?next=%2Finvite"]')).not.toBeNull();
    expect(previewTeamInvite).not.toHaveBeenCalled();
  });

  it('offers sign-in when preview answers 401', async () => {
    previewTeamInvite.mockRejectedValue(
      new ApiClientError({ code: 'UNAUTHORIZED', message: 'Unauthorized' }, 401),
    );
    await render();

    expect(container.querySelector('a[href="/login?next=%2Finvite"]')).not.toBeNull();
    expect(buttonLabels()).not.toContain(en['web.team.retry']);
  });

  it('shows the join again on a reload after joining', async () => {
    search = new URLSearchParams('joined=1');
    await render();

    expect(text()).toContain(en['web.invite.joined']);
    expect(previewTeamInvite).not.toHaveBeenCalled();
  });

  it('shows the team name as plain text and joins on one button', async () => {
    previewTeamInvite.mockResolvedValue(PENDING);
    acceptTeamInvite.mockResolvedValue(TEAM);
    await render();

    expect(container.querySelector('b')).toBeNull();
    expect(text()).toContain('Cardiology <b>unit</b>');
    expect(text()).toContain('Invited by lead@example.com');
    await click(en['web.invite.join']);

    expect(acceptTeamInvite).toHaveBeenCalledWith(TOKEN);
    expect(text()).toContain(en['web.invite.joined']);
    expect(window.location.pathname + window.location.search).toBe('/invite?joined=1');
    expect(readPendingInvite()).toBeNull();
    expect(JSON.parse(localStorage.getItem('chatofy.workspace')!)).toEqual({
      userId: 'u1',
      value: TEAM.team.id,
    });
  });

  it('offers sign-out and no Join for another account, and keeps the invite', async () => {
    previewTeamInvite.mockResolvedValue({
      status: 'wrong-account',
      teamName: null,
      role: null,
      inviterEmail: null,
    });
    await render();

    expect(text()).toContain(en['web.invite.wrongAccount']);
    expect(buttonLabels()).toEqual([en['common.auth.signOut']]);
    await click(en['common.auth.signOut']);
    expect(signOut).toHaveBeenCalledWith({ redirectTo: '/login?next=%2Finvite' });
    expect(readPendingInvite()).toBe(TOKEN);
  });

  it.each([
    [403, 'web.invite.wrongAccount'],
    [404, 'web.invite.invalid'],
  ] as const)('maps an accept %i to its copy', async (status, key) => {
    previewTeamInvite.mockResolvedValue(PENDING);
    acceptTeamInvite.mockRejectedValue(
      new ApiClientError({ code: 'FORBIDDEN', message: 'Refused.' }, status),
    );
    await render();
    await click(en['web.invite.join']);
    expect(text()).toContain(en[key]);
  });

  it.each(['team-cap', 'team-full'] as const)(
    'keeps a %s invite, but stops it steering later sign-ins',
    async (status) => {
      const { hasInviteAwaitingSignIn } = await import('@/lib/pending-invite');
      previewTeamInvite.mockResolvedValue({
        status,
        teamName: null,
        role: null,
        inviterEmail: null,
      });
      await render();
      expect(readPendingInvite()).toBe(TOKEN);
      expect(hasInviteAwaitingSignIn()).toBe(false);
    },
  );

  it('reads an accept refusal from its details, without previewing again', async () => {
    previewTeamInvite.mockResolvedValue(PENDING);
    acceptTeamInvite.mockRejectedValue(
      new ApiClientError(
        {
          code: 'INVITE_NOT_PENDING',
          message: 'This invite has already been used.',
          details: [{ path: 'status', message: 'accepted' }],
        },
        409,
      ),
    );
    await render();
    await click(en['web.invite.join']);

    expect(text()).toContain(en['web.invite.used']);
    expect(previewTeamInvite).toHaveBeenCalledTimes(1);
    expect(readPendingInvite()).toBeNull();
  });
});
