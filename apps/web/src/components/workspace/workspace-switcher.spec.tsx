// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';
import type { TeamSummary } from '@chatofy/types';
import { SidebarProvider } from '@chatofy/ui/react';

/** The switcher shows where you are and moves you; the topbar chip is the same menu. */
const session = vi.hoisted(() => ({
  value: {
    data: { user: { id: 'u1', name: 'Quang Anh', email: 'qa@example.com' } },
    status: 'authenticated',
  },
}));
vi.mock('next-auth/react', () => ({ useSession: () => session.value }));

const openSettingsDialog = vi.hoisted(() => vi.fn());
vi.mock('@/components/settings/use-settings-dialog', () => ({ openSettingsDialog }));

const { WorkspaceSwitcher } = await import('./workspace-switcher');
const { WorkspaceTestHost } = await import('./workspace-provider');
const { consumeTeamCreateIntent } = await import('./team-create-intent');
const { LocaleProvider } = await import('@/i18n/provider');
type HostValue = Parameters<typeof WorkspaceTestHost>[0]['value'];

const TEAM: TeamSummary = {
  id: 'c' + 'a'.repeat(24),
  name: 'Cardiology unit',
  role: 'admin',
  memberCount: 3,
  createdAt: '2026-11-14T00:00:00.000Z',
};

let root: Root | undefined;
let container: HTMLElement;
const select = vi.fn();
const reloadTeams = vi.fn(async () => {});

function render(variant: 'sidebar' | 'chip', value: HostValue) {
  act(() => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <SidebarProvider>
          <WorkspaceTestHost value={{ select, reloadTeams, teams: [TEAM], ...value }}>
            <WorkspaceSwitcher variant={variant} />
          </WorkspaceTestHost>
        </SidebarProvider>
      </LocaleProvider>,
    );
  });
}

const trigger = () => document.querySelector<HTMLElement>('[data-workspace-switcher]')!;

/** Radix opens a dropdown on `pointerdown`, so a bare click would not. */
async function open() {
  await act(async () => {
    trigger().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const menuItems = () => [
  ...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]'),
];
const item = (label: string) => menuItems().find((el) => el.textContent === label);
const option = (id: string) =>
  document.querySelector<HTMLElement>(`[role="menu"] [data-workspace-option="${id}"]`);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  select.mockClear();
  reloadTeams.mockClear();
  openSettingsDialog.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

describe('WorkspaceSwitcher trigger', () => {
  it('shows a team tile, the team name, its role and a chevron', () => {
    render('sidebar', { workspace: { kind: 'team', team: TEAM } });
    const t = trigger();
    expect(t.querySelector('[data-workspace-tile="team"]')?.textContent).toBe('C');
    expect(t.textContent).toContain(TEAM.name);
    expect(t.textContent).toContain('Team · Admin');
    expect(t.querySelector('svg.lucide-chevrons-up-down')).not.toBeNull();
    expect(t.getAttribute('aria-label')).toBe(`Switch workspace, current: ${TEAM.name}`);
  });

  it("shows personal as the reader's own tile and name over a Personal subline", () => {
    render('sidebar', { workspace: { kind: 'personal' } });
    const t = trigger();
    expect(t.querySelector('[data-workspace-tile="personal"]')?.textContent).toBe('Q');
    expect(t.textContent).toContain('Quang Anh');
    expect(t.textContent).toContain(en['web.workspace.personal']);
  });

  it('falls through an empty session name to the email', () => {
    const saved = session.value;
    session.value = {
      data: { user: { id: 'u1', name: '', email: 'zed@example.com' } },
      status: 'authenticated',
    };
    try {
      render('sidebar', { workspace: { kind: 'personal' } });
      expect(trigger().querySelector('[data-workspace-tile="personal"]')?.textContent).toBe('Z');
      expect(trigger().textContent).toContain('zed@example.com');
    } finally {
      session.value = saved;
    }
  });

  it('draws a neutral placeholder while the workspace resolves', () => {
    render('sidebar', { workspace: { kind: 'resolving' } });
    expect(trigger().querySelector('[data-workspace-tile]')).toBeNull();
    expect(trigger().textContent).toContain(en['web.workspace.label']);
  });

  it('renders the chip below md only, unfilled, named for the current workspace', () => {
    render('chip', { workspace: { kind: 'team', team: TEAM } });
    const chip = trigger();
    expect(chip.hasAttribute('data-workspace-chip')).toBe(true);
    expect(chip.classList.contains('md:hidden')).toBe(true);
    expect(chip.className).not.toMatch(/(^|\s)bg-primary(\s|$)/);
    expect(chip.querySelector('[data-workspace-tile="team"]')).not.toBeNull();
    expect(chip.getAttribute('aria-label')).toBe(`Switch workspace, current: ${TEAM.name}`);
  });

  it('names personal as Personal on the chip, where there is no subline', () => {
    render('chip', { workspace: { kind: 'personal' } });
    expect(trigger().getAttribute('aria-label')).toBe(
      `Switch workspace, current: ${en['web.workspace.personal']}`,
    );
  });
});

describe('WorkspaceSwitcher menu', () => {
  it('selects a team from the menu', async () => {
    render('sidebar', { workspace: { kind: 'personal' } });
    await open();
    act(() => option(TEAM.id)!.click());
    expect(select).toHaveBeenCalledWith(TEAM.id);
  });

  it('lists each team with its tile and role, and checks the active one', async () => {
    render('sidebar', { workspace: { kind: 'team', team: TEAM } });
    await open();
    const row = option(TEAM.id)!;
    expect(row.querySelector('[data-workspace-tile="team"]')).not.toBeNull();
    expect(row.textContent).toContain(TEAM.name);
    expect(row.textContent).toContain(en['web.team.roleAdmin']);
    expect(row.getAttribute('aria-checked')).toBe('true');
    expect(option('personal')!.querySelector('[data-workspace-tile="personal"]')).not.toBeNull();
    expect(option('personal')!.getAttribute('aria-checked')).toBe('false');
  });

  it('offers a retry when the team list failed', async () => {
    render('sidebar', { workspace: { kind: 'resolving' }, teamsStatus: 'failed' });
    await open();
    expect(document.querySelector('[role="menu"] [role="alert"]')?.textContent).toBe(
      en['web.team.loadFailed'],
    );
    act(() => item(en['web.team.retry'])!.click());
    expect(reloadTeams).toHaveBeenCalled();
  });

  it('checks no workspace while it resolves', async () => {
    render('sidebar', { workspace: { kind: 'resolving' }, teamsStatus: 'failed' });
    await open();
    expect(document.querySelector('[role="menuitemradio"][aria-checked="true"]')).toBeNull();
  });

  it('Create team inside a team stays in it and opens Settings › Team with the form requested', async () => {
    render('sidebar', { workspace: { kind: 'team', team: TEAM } });
    await open();
    act(() => item(en['web.workspace.createTeam'])!.click());
    // Nothing switches until a team exists: the create form succeeds or it is cancelled.
    expect(select).not.toHaveBeenCalled();
    expect(openSettingsDialog).toHaveBeenCalledWith('team');
    expect(consumeTeamCreateIntent()).toBe(true);
  });

  it('Create team from personal does not reselect', async () => {
    render('chip', { workspace: { kind: 'personal' } });
    await open();
    act(() => item(en['web.workspace.createTeam'])!.click());
    expect(select).not.toHaveBeenCalled();
    expect(openSettingsDialog).toHaveBeenCalledWith('team');
  });

  it('says Manage team inside a team and Manage teams from personal', async () => {
    render('sidebar', { workspace: { kind: 'team', team: TEAM } });
    await open();
    act(() => item(en['web.workspace.manageTeam'])!.click());
    expect(openSettingsDialog).toHaveBeenCalledWith('team');
    act(() => root?.unmount());

    root = undefined;
    render('sidebar', { workspace: { kind: 'personal' } });
    await open();
    expect(item(en['web.workspace.manageTeams'])).toBeDefined();
    expect(item(en['web.workspace.manageTeam'])).toBeUndefined();
  });

  it('opens the same menu from the chip', async () => {
    render('chip', { workspace: { kind: 'personal' } });
    await open();
    expect(option('personal')).not.toBeNull();
    expect(option(TEAM.id)).not.toBeNull();
    expect(item(en['web.workspace.createTeam'])).toBeDefined();
    expect(item(en['web.workspace.manageTeams'])).toBeDefined();
  });
});
