// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';
import { ApiClientError } from '@chatofy/api-client';
import type { TeamMemberEntry, TeamRole, TeamSummary } from '@chatofy/types';
import { member, team } from './team.fixture';

/**
 * Settings › Team by role: what each role may do is what each role sees, refusals
 * map by status, and a team that vanished sends the workspace back to its team list.
 */
const listTeamMembers = vi.fn<() => Promise<{ members: TeamMemberEntry[] }>>();
const listTeamInvites = vi.fn<() => Promise<{ invites: unknown[] }>>();
const createTeamInvite = vi.fn<() => Promise<unknown>>();
const removeTeamMember = vi.fn<() => Promise<unknown>>();
const createTeam = vi.fn<() => Promise<{ team: TeamSummary }>>();
const deleteTeam = vi.fn<() => Promise<unknown>>();
const select = vi.fn();
const notifySuccess = vi.fn<(...args: unknown[]) => void>();

vi.mock('@/clients/teams-api-client', () => ({
  listTeamMembers: () => listTeamMembers(),
  listTeamInvites: () => listTeamInvites(),
  createTeamInvite: () => createTeamInvite(),
  createTeam: () => createTeam(),
  renameTeam: vi.fn(),
  deleteTeam: () => deleteTeam(),
  changeTeamMemberRole: vi.fn(),
  removeTeamMember: () => removeTeamMember(),
  revokeTeamInvite: vi.fn(),
}));

vi.mock('@/lib/notify', () => ({
  notify: { success: (...args: unknown[]) => notifySuccess(...args) },
}));

const { TeamTabContent } = await import('./team-tab-content');
const { requestTeamCreateForm } = await import('@/components/workspace/team-create-intent');
const { WorkspaceTestHost } = await import('@/components/workspace/workspace-provider');
const { LocaleProvider } = await import('@/i18n/provider');
type HostValue = Parameters<typeof WorkspaceTestHost>[0]['value'];

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
        <WorkspaceTestHost value={{ reloadTeams, select, ...value }}>
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
const dialogButton = (label: string) =>
  [...document.querySelectorAll('[role="alertdialog"] button')].find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement;
const headings = () => [...document.querySelectorAll('h3')].map((h) => h.textContent);

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
  select.mockClear();
  listTeamMembers.mockResolvedValue({
    members: [
      member('o', 'owner', false, 'owner@example.com'),
      member('a', 'admin', false, 'admin@example.com'),
      member('m', 'member', false, 'member@example.com'),
    ],
  });
  listTeamInvites.mockResolvedValue({ invites: [] });
  createTeamInvite.mockReset();
  notifySuccess.mockClear();
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

  it('goes back to personal when leaving finds the team already gone', async () => {
    listTeamMembers.mockResolvedValue({
      members: [member('o', 'owner', false, null), member('m', 'member', true, 'me@example.com')],
    });
    removeTeamMember.mockRejectedValue(
      new ApiClientError({ code: 'NOT_FOUND', message: 'Not found.' }, 404),
    );
    await inTeam('member');
    act(() => button(en['web.team.leave'])!.click());
    await settle();
    const confirm = [...document.querySelectorAll('[role="alertdialog"] button')].find(
      (b) => b.textContent === en['web.team.leave'],
    ) as HTMLButtonElement;
    act(() => confirm.click());
    await settle();
    expect(select).toHaveBeenCalledWith('personal');
    expect(reloadTeams).toHaveBeenCalled();
    expect(text()).not.toContain(en['web.team.actionFailed']);
  });

  it('reloads the teams when an invite answers 403, so a demoted admin loses the form', async () => {
    createTeamInvite.mockRejectedValue(
      new ApiClientError({ code: 'FORBIDDEN', message: 'Forbidden.' }, 403),
    );
    // The reloaded team list says the caller is now a plain member.
    reloadTeams.mockImplementationOnce(() => {
      act(() => {
        root?.render(
          <LocaleProvider>
            <WorkspaceTestHost
              value={{ reloadTeams, select, workspace: { kind: 'team', team: team('member') } }}
            >
              <TeamTabContent />
            </WorkspaceTestHost>
          </LocaleProvider>,
        );
      });
      return Promise.resolve();
    });
    await inTeam('admin');
    type(document.querySelector<HTMLInputElement>('input[type="email"]')!, 'new@example.com');
    act(() => {
      document.querySelector<HTMLInputElement>('input[type="email"]')!.form!.requestSubmit();
    });
    await settle();
    expect(reloadTeams).toHaveBeenCalled();
    expect(document.querySelector('input[type="email"]')).toBeNull();
  });

  it('says the invites failed to load and offers a retry', async () => {
    listTeamInvites.mockRejectedValueOnce(new Error('offline'));
    await inTeam('owner');
    expect(document.querySelector('[data-invites-failed] [role="alert"]')?.textContent).toBe(
      en['web.team.loadFailed'],
    );
    act(() => document.querySelector<HTMLButtonElement>('[data-invites-failed] button')!.click());
    await settle();
    expect(document.querySelector('[data-invites-failed]')).toBeNull();
  });

  it.each([404, 403])('reloads the teams when the member list answers %i', async (status) => {
    listTeamMembers.mockRejectedValue(
      new ApiClientError(
        { code: status === 404 ? 'NOT_FOUND' : 'FORBIDDEN', message: 'Refused.' },
        status,
      ),
    );
    await inTeam('member');
    expect(reloadTeams).toHaveBeenCalled();
  });
  it('names the team, the role and the seats at the top of the team view', async () => {
    await inTeam('owner');
    const header = document.querySelector('[data-team-header]')!;
    expect(header.querySelector('[data-workspace-tile="team"]')?.textContent).toBe('C');
    expect(header.textContent).toContain('Cardiology unit');
    // Three live members, not the summary's count, against the 20-seat cap.
    expect(header.textContent).toContain('Owner · 3 / 20 members');
  });

  it('orders the owner view Members, Invite people, Team name, Danger zone', async () => {
    await inTeam('owner');
    expect(headings()).toEqual([
      en['web.team.members'],
      en['web.team.inviteHeading'],
      en['web.team.nameHeading'],
      en['web.team.dangerZone'],
    ]);
    const danger = [...document.querySelectorAll('h3')].at(-1)!;
    expect(danger.className).toContain('text-destructive');
    const trigger = document.querySelector('[data-team-confirm="delete"]')!;
    expect(trigger.className).toContain('text-destructive');
    expect(trigger.className).not.toContain('bg-live-fill');
    expect(text()).toContain(en['web.team.deleteRowNote']);
  });

  it('gives a member Members and a Danger zone with Leave, nothing else', async () => {
    listTeamMembers.mockResolvedValue({
      members: [member('o', 'owner', false, null), member('m', 'member', true, 'me@example.com')],
    });
    await inTeam('member');
    expect(headings()).toEqual([en['web.team.members'], en['web.team.dangerZone']]);
    expect(text()).toContain(en['web.team.leaveRowNote']);
    expect(document.querySelector('[data-team-confirm="delete"]')).toBeNull();
  });

  it('lists pending invites under the form with their expiry, and expired ones as such', async () => {
    listTeamInvites.mockResolvedValue({
      invites: [
        {
          id: 'c' + 'p'.repeat(24),
          email: 'new@example.com',
          role: 'member',
          status: 'pending',
          expiresAt: '2026-11-21T12:00:00.000Z',
          createdAt: '2026-11-14T00:00:00.000Z',
        },
        {
          id: 'c' + 'x'.repeat(24),
          email: 'old@example.com',
          role: 'member',
          status: 'expired',
          expiresAt: '2026-11-01T00:00:00.000Z',
          createdAt: '2026-10-25T00:00:00.000Z',
        },
      ],
    });
    await inTeam('owner');
    const form = document.querySelector('[data-team-invite-form]')!;
    const rows = [...document.querySelectorAll('[data-invite-row]')];
    expect(rows).toHaveLength(2);
    expect(form.compareDocumentPosition(rows[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rows[0]!.querySelector('[data-invite-status]')?.textContent).toBe(
      'Pending · expires Nov 21',
    );
    expect(rows[1]!.querySelector('[data-invite-status]')?.textContent).toBe(
      en['web.team.inviteExpired'],
    );
  });

  it('opens on the create form when another screen asked to start a team', async () => {
    requestTeamCreateForm();
    await render({ workspace: { kind: 'personal' }, teams: [] });
    expect(document.querySelector('input[name="team-name"]')).not.toBeNull();
    // Taken once: the next visit opens on the button again.
    act(() => root?.unmount());
    await render({ workspace: { kind: 'personal' }, teams: [] });
    expect(document.querySelector('input[name="team-name"]')).toBeNull();
  });

  /** The provider moving the reader, played by re-rendering the same tree. */
  function rerender(value: HostValue) {
    act(() => {
      root?.render(
        <LocaleProvider>
          <WorkspaceTestHost value={{ reloadTeams, select, ...value }}>
            <TeamTabContent />
          </WorkspaceTestHost>
        </LocaleProvider>,
      );
    });
  }
  const nameInput = () => document.querySelector('input[name="team-name"]');

  it('ends the create request once the reader is in another workspace', async () => {
    requestTeamCreateForm();
    await render({ workspace: { kind: 'personal' }, teams: [team('owner')] });
    expect(nameInput()).not.toBeNull();
    rerender({ workspace: { kind: 'team', team: team('owner') }, teams: [team('owner')] });
    await settle();
    expect(nameInput()).toBeNull();
    expect(document.querySelector('[data-team-header]')).not.toBeNull();
    // Back in personal after a Delete, a Leave or a switch: the plain list, no form.
    rerender({ workspace: { kind: 'personal' }, teams: [team('owner')] });
    await settle();
    expect(nameInput()).toBeNull();
    expect(document.querySelector('[data-team-create]')).not.toBeNull();
  });

  it('shows the create form inside a team without leaving it, and Cancel returns to the team', async () => {
    requestTeamCreateForm();
    await inTeam('owner');
    expect(nameInput()).not.toBeNull();
    expect(document.querySelector('[data-team-header]')).toBeNull();
    // Headed as a create, so it cannot be taken for renaming the current team.
    const heading = document.querySelector('[data-team-create-requested] h3');
    expect(heading?.textContent).toBe(en['web.team.create']);
    expect(select).not.toHaveBeenCalled();
    act(() => button(en['web.team.cancel'])!.click());
    await settle();
    expect(nameInput()).toBeNull();
    expect(document.querySelector('[data-team-header]')).not.toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it('holds a create request while the workspace resolves, then shows it where it settles', async () => {
    requestTeamCreateForm();
    await render({ workspace: { kind: 'resolving' } });
    expect(nameInput()).toBeNull();
    rerender({ workspace: { kind: 'personal' }, teams: [] });
    await settle();
    expect(nameInput()).not.toBeNull();
  });

  it('Cancel on a requested create form in personal leaves the plain personal view', async () => {
    requestTeamCreateForm();
    await render({ workspace: { kind: 'personal' }, teams: [team('admin')] });
    act(() => button(en['web.team.cancel'])!.click());
    await settle();
    expect(nameInput()).toBeNull();
    expect(document.querySelector('[data-team-row]')).not.toBeNull();
    expect(document.querySelector('[data-team-create]')).not.toBeNull();
  });

  it('names each Open button for its team', async () => {
    await render({ workspace: { kind: 'personal' }, teams: [team('admin')] });
    const open = document.querySelector('[data-team-row] button');
    expect(open?.getAttribute('aria-label')).toBe(`Open ${team('admin').name}`);
  });

  it('keeps the destructive trigger on its red-tinted hover, not the outline grey', async () => {
    await inTeam('owner');
    const trigger = document.querySelector('[data-team-confirm="delete"]')!;
    expect(trigger.className).toMatch(/(^|\s)hover:bg-live-subtle(\s|$)/);
    expect(trigger.className).not.toMatch(/(^|\s)hover:bg-border(\s|$)/);
  });

  it('lists each team with its tile, member count and role', async () => {
    await render({
      workspace: { kind: 'personal' },
      teams: [team('admin'), { ...team('member'), id: 'c' + 'b'.repeat(24), memberCount: 1 }],
    });
    const rows = [...document.querySelectorAll('[data-team-row]')];
    expect(rows[0]!.querySelector('[data-workspace-tile="team"]')).not.toBeNull();
    expect(rows[0]!.textContent).toContain('3 members');
    expect(rows[0]!.textContent).toContain(en['web.team.roleAdmin']);
    expect(rows[1]!.textContent).toContain('1 member');
    expect(rows[1]!.textContent).not.toContain('1 members');
  });

  it('after creating, switches to the team, says so, and puts the caret in the invite email', async () => {
    const created = { ...team('owner'), name: 'Night shift' };
    createTeam.mockResolvedValue({ team: created });
    // The provider's switch, played by re-rendering into the new team.
    select.mockImplementationOnce(() => {
      act(() => {
        root?.render(
          <LocaleProvider>
            <WorkspaceTestHost
              value={{ reloadTeams, select, workspace: { kind: 'team', team: created } }}
            >
              <TeamTabContent />
            </WorkspaceTestHost>
          </LocaleProvider>,
        );
      });
    });
    await render({ workspace: { kind: 'personal' }, teams: [] });
    act(() => document.querySelector<HTMLButtonElement>('[data-team-create]')!.click());
    type(document.querySelector<HTMLInputElement>('input[name="team-name"]')!, 'Night shift');
    act(() => {
      document.querySelector<HTMLInputElement>('input[name="team-name"]')!.form!.requestSubmit();
    });
    await settle();
    expect(select).toHaveBeenCalledWith(created.id);
    expect(notifySuccess).toHaveBeenCalledWith('Night shift created', {
      description: en['web.team.createdHint'],
    });
    expect(document.activeElement).toBe(document.querySelector('input[type="email"]'));
  });

  it('does not take focus to the invite email on an ordinary visit', async () => {
    await inTeam('owner');
    expect(document.activeElement).not.toBe(document.querySelector('input[type="email"]'));
  });

  it('says the team was deleted and lands in personal', async () => {
    deleteTeam.mockResolvedValue({});
    await inTeam('owner');
    act(() => button(en['web.team.delete'])!.click());
    await settle();
    type(
      document.querySelector<HTMLInputElement>('[data-delete-confirm-name]')!,
      'Cardiology unit',
    );
    act(() => dialogButton(en['web.team.delete']).click());
    await settle();
    expect(select).toHaveBeenCalledWith('personal');
    expect(notifySuccess).toHaveBeenCalledWith('Cardiology unit was deleted');
  });

  it('says you left the team and lands in personal', async () => {
    listTeamMembers.mockResolvedValue({
      members: [member('o', 'owner', false, null), member('m', 'member', true, 'me@example.com')],
    });
    removeTeamMember.mockResolvedValue({});
    await inTeam('member');
    act(() => button(en['web.team.leave'])!.click());
    await settle();
    act(() => dialogButton(en['web.team.leave']).click());
    await settle();
    expect(select).toHaveBeenCalledWith('personal');
    expect(notifySuccess).toHaveBeenCalledWith('You left Cardiology unit');
  });
});
