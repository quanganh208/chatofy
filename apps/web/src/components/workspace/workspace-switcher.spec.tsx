// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';
import type { TeamSummary } from '@chatofy/types';
import { SidebarProvider } from '@chatofy/ui/react';

/** The switcher shows where you are and moves you; the sheet row is the same menu. */
const { WorkspaceSwitcher } = await import('./workspace-switcher');
const { WorkspaceTestHost } = await import('./workspace-provider');
const { LocaleProvider } = await import('@/i18n/provider');
type HostValue = Parameters<typeof WorkspaceTestHost>[0]['value'];

const TEAM: TeamSummary = {
  id: 'c' + 'a'.repeat(24),
  name: 'Cardiology unit',
  role: 'member',
  memberCount: 3,
  createdAt: '2026-11-14T00:00:00.000Z',
};

let root: Root | undefined;
let container: HTMLElement;
const select = vi.fn();
const reloadTeams = vi.fn(async () => {});

function render(variant: 'sidebar' | 'sheet-row', value: HostValue) {
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

/** Radix opens a dropdown on `pointerdown`, so a bare click would not. */
async function open() {
  const trigger = document.querySelector<HTMLElement>('[data-workspace-switcher]')!;
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const item = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')].find(
    (el) => el.textContent === label,
  );

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  select.mockClear();
  reloadTeams.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

describe('WorkspaceSwitcher', () => {
  it('selects a team from the menu', async () => {
    render('sidebar', { workspace: { kind: 'personal' } });
    await open();
    act(() => item(TEAM.name)!.click());
    expect(select).toHaveBeenCalledWith(TEAM.id);
  });

  it('names the active team on its trigger', () => {
    render('sidebar', { workspace: { kind: 'team', team: TEAM } });
    expect(document.querySelector('[data-workspace-switcher]')?.textContent).toContain(TEAM.name);
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

  it('hands Manage teams to the host when one is given', async () => {
    const onManageTeams = vi.fn();
    act(() => {
      root = createRoot(container);
      root.render(
        <LocaleProvider>
          <WorkspaceTestHost value={{ select, reloadTeams, teams: [TEAM] }}>
            <WorkspaceSwitcher variant="sheet-row" onManageTeams={onManageTeams} />
          </WorkspaceTestHost>
        </LocaleProvider>,
      );
    });
    await open();
    act(() => item(en['web.workspace.manageTeams'])!.click());
    expect(onManageTeams).toHaveBeenCalled();
  });

  it('renders the same menu as a More sheet row', async () => {
    render('sheet-row', { workspace: { kind: 'personal' } });
    await open();
    expect(item(en['web.workspace.personal'])).toBeDefined();
    expect(item(TEAM.name)).toBeDefined();
    expect(item(en['web.workspace.manageTeams'])).toBeDefined();
  });
});
