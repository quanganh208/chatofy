// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';
import { ApiClientError } from '@chatofy/api-client';
import type { TeamMemberEntry, TeamRole, TeamSummary } from '@chatofy/types';

/**
 * Settings › Team by role: what each role may do is what each role sees, refusals
 * map by status, and a team that vanished sends the workspace back to its team list.
 */
const listTeamMembers = vi.fn<() => Promise<{ members: TeamMemberEntry[] }>>();
const listTeamInvites = vi.fn<() => Promise<{ invites: unknown[] }>>();
const createTeamInvite = vi.fn<() => Promise<unknown>>();

vi.mock('@/clients/teams-api-client', () => ({
  listTeamMembers: () => listTeamMembers(),
  listTeamInvites: () => listTeamInvites(),
  createTeamInvite: () => createTeamInvite(),
  createTeam: vi.fn(),
  renameTeam: vi.fn(),
  deleteTeam: vi.fn(),
  changeTeamMemberRole: vi.fn(),
  removeTeamMember: vi.fn(),
  revokeTeamInvite: vi.fn(),
}));

const { TeamTabContent } = await import('./team-tab-content');
const { WorkspaceTestHost } = await import('@/components/workspace/workspace-provider');
const { LocaleProvider } = await import('@/i18n/provider');
type HostValue = Parameters<typeof WorkspaceTestHost>[0]['value'];

const team = (role: TeamRole): TeamSummary => ({
  id: 'c' + 'a'.repeat(24),
  name: 'Cardiology unit',
  role,
  memberCount: 3,
  createdAt: '2026-11-14T00:00:00.000Z',
});
const member = (
  id: string,
  role: TeamRole,
  isSelf: boolean,
  email: string | null,
): TeamMemberEntry => ({
  id: 'c' + id.repeat(24),
  name: `Name ${id}`,
  email,
  avatarUrl: null,
  role,
  joinedAt: '2026-11-14T00:00:00.000Z',
  isSelf,
});

let root: Root | undefined;
let container: HTMLElement;
const reloadTeams = vi.fn(async () => {});

async function settle() {
  await act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
}

async function render(value: HostValue) {
  act(() => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <WorkspaceTestHost value={{ reloadTeams, ...value }}>
          <TeamTabContent />
        </WorkspaceTestHost>
      </LocaleProvider>,
    );
  });
  await settle();
}

const inTeam = (role: TeamRole) => render({ workspace: { kind: 'team', team: team(role) } });
const text = () => document.body.textContent ?? '';
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === label);

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  reloadTeams.mockClear();
  listTeamMembers.mockResolvedValue({
    members: [
      member('o', 'owner', false, 'owner@example.com'),
      member('a', 'admin', false, 'admin@example.com'),
      member('m', 'member', false, 'member@example.com'),
    ],
  });
  listTeamInvites.mockResolvedValue({ invites: [] });
  createTeamInvite.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

describe('Settings › Team', () => {
  it('says you are in no team when personal has none', async () => {
    await render({ workspace: { kind: 'personal' }, teams: [] });
    expect(text()).toContain(en['web.team.none']);
  });

  it('offers a retry when the team list failed', async () => {
    await render({ workspace: { kind: 'resolving' }, teamsStatus: 'failed' });
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(en['web.team.loadFailed']);
    act(() => button(en['web.team.retry'])!.click());
    expect(reloadTeams).toHaveBeenCalled();
  });

  it('gives the owner the invite form with the admin role', async () => {
    await inTeam('owner');
    expect(document.querySelector('input[type="email"]')).not.toBeNull();
    expect(document.querySelector('form [aria-label="Role"]')).not.toBeNull();
  });

  it('gives an admin the invite form without the role, and Remove on member rows only', async () => {
    listTeamMembers.mockResolvedValue({
      members: [
        member('o', 'owner', false, 'owner@example.com'),
        member('a', 'admin', true, 'admin@example.com'),
        member('m', 'member', false, 'member@example.com'),
      ],
    });
    await inTeam('admin');
    expect(document.querySelector('input[type="email"]')).not.toBeNull();
    expect(document.querySelector('form [aria-label="Role"]')).toBeNull();
    const removable = [...document.querySelectorAll('[data-member-remove]')].map((b) =>
      b.closest('[data-member-row]')?.getAttribute('data-member-row'),
    );
    expect(removable).toEqual(['c' + 'm'.repeat(24)]);
  });

  it('gives a member Leave and no invite form, and shows no other email', async () => {
    listTeamMembers.mockResolvedValue({
      members: [member('o', 'owner', false, null), member('m', 'member', true, 'me@example.com')],
    });
    await inTeam('member');
    expect(document.querySelector('input[type="email"]')).toBeNull();
    expect(button(en['web.team.leave'])).toBeDefined();
    const ownerRow = document.querySelector(`[data-member-row="c${'o'.repeat(24)}"]`);
    expect(ownerRow?.textContent).not.toContain('@');
  });

  it('keeps delete disabled until the typed name matches', async () => {
    await inTeam('owner');
    act(() => button(en['web.team.delete'])!.click());
    await settle();
    const confirm = () =>
      [...document.querySelectorAll('[role="alertdialog"] button')].find(
        (b) => b.textContent === en['web.team.delete'],
      ) as HTMLButtonElement;
    const input = document.querySelector<HTMLInputElement>('[data-delete-confirm-name]')!;
    expect(confirm().disabled).toBe(true);
    type(input, 'Cardiology');
    expect(confirm().disabled).toBe(true);
    type(input, 'Cardiology unit');
    expect(confirm().disabled).toBe(false);
  });

  it('says why an invite was refused on 409', async () => {
    createTeamInvite.mockRejectedValue(
      new ApiClientError({ code: 'CONFLICT', message: 'Already invited.' }, 409),
    );
    await inTeam('owner');
    type(document.querySelector<HTMLInputElement>('input[type="email"]')!, 'new@example.com');
    act(() => {
      document.querySelector<HTMLInputElement>('input[type="email"]')!.form!.requestSubmit();
    });
    await settle();
    expect(text()).toContain(en['web.team.inviteRefused']);
  });

  it('reloads the teams when the team answers 404', async () => {
    listTeamMembers.mockRejectedValue(
      new ApiClientError({ code: 'NOT_FOUND', message: 'Not found.' }, 404),
    );
    await inTeam('member');
    expect(reloadTeams).toHaveBeenCalled();
  });
});
