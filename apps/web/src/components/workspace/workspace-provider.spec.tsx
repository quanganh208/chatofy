// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamListResponse, TeamSummary } from '@chatofy/types';

/**
 * The workspace resolves only from facts that loaded: a failed team list never
 * moves anyone back to personal, and only a list that loaded and lacks the stored
 * team does.
 */
const listTeams = vi.fn<() => Promise<TeamListResponse>>();
const session = { value: { data: null as unknown, status: 'loading' } };

vi.mock('@/clients/teams-api-client', () => ({ listTeams: () => listTeams() }));
vi.mock('next-auth/react', () => ({ useSession: () => session.value }));

const { WorkspaceProvider, useWorkspace } = await import('./workspace-provider');
const { WORKSPACE_STORAGE_KEY, writeStoredWorkspace } = await import('@/lib/workspace-store');
type Value = ReturnType<typeof useWorkspace>;

const TEAM: TeamSummary = {
  id: 'c' + 'a'.repeat(24),
  name: 'Cardiology unit',
  role: 'admin',
  memberCount: 3,
  createdAt: '2026-11-14T00:00:00.000Z',
};
const SIGNED_IN = { data: { user: { id: 'u1' } }, status: 'authenticated' };

let root: Root | undefined;
let container: HTMLElement;
let seen: Value | undefined;

/** Hands each render's value out through a callback, not a write to module state. */
function Probe({ onValue }: { onValue: (value: Value) => void }) {
  const value = useWorkspace();
  useEffect(() => {
    onValue(value);
  });
  return null;
}

async function settle() {
  await act(async () => {
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
  });
}

async function render() {
  act(() => {
    root = createRoot(container);
    root.render(
      <WorkspaceProvider>
        <Probe onValue={(value) => (seen = value)} />
      </WorkspaceProvider>,
    );
  });
  await settle();
}

const storedValue = () =>
  (JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? 'null') as { value: string } | null)
    ?.value;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  session.value = SIGNED_IN;
  listTeams.mockReset();
  seen = undefined;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

describe('WorkspaceProvider', () => {
  it('is resolving while the session loads, and asks for no teams', async () => {
    session.value = { data: null, status: 'loading' };
    await render();
    expect(seen?.workspace).toEqual({ kind: 'resolving' });
    expect(listTeams).not.toHaveBeenCalled();
  });

  it('is personal when signed out', async () => {
    session.value = { data: null, status: 'unauthenticated' };
    await render();
    expect(seen?.workspace).toEqual({ kind: 'personal' });
  });

  it('falls back to personal, and records it, when a loaded list lacks the stored team', async () => {
    writeStoredWorkspace('u1', 'c' + 'z'.repeat(24));
    listTeams.mockResolvedValue({ teams: [TEAM] });
    await render();
    expect(seen?.workspace).toEqual({ kind: 'personal' });
    expect(storedValue()).toBe('personal');
  });

  it('resolves a stored team it finds', async () => {
    writeStoredWorkspace('u1', TEAM.id);
    listTeams.mockResolvedValue({ teams: [TEAM] });
    await render();
    expect(seen?.workspace).toEqual({ kind: 'team', team: TEAM });
  });

  it('is resolving while the teams load', async () => {
    writeStoredWorkspace('u1', TEAM.id);
    listTeams.mockReturnValue(new Promise(() => {}));
    await render();
    expect(seen?.workspace).toEqual({ kind: 'resolving' });
    expect(seen?.teamsStatus).toBe('loading');
  });

  it('keeps the stored team through a failed load, and resolves it on a good reload', async () => {
    writeStoredWorkspace('u1', TEAM.id);
    listTeams.mockRejectedValueOnce(new Error('offline'));
    await render();
    expect(seen?.workspace).toEqual({ kind: 'resolving' });
    expect(seen?.teamsStatus).toBe('failed');
    expect(storedValue()).toBe(TEAM.id);

    listTeams.mockResolvedValue({ teams: [TEAM] });
    await act(async () => {
      await seen?.reloadTeams();
    });
    await settle();
    expect(seen?.workspace).toEqual({ kind: 'team', team: TEAM });
  });
});
