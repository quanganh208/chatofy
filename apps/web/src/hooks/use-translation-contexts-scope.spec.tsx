// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@chatofy/api-client';
import type { TeamSummary, TranslationContext } from '@chatofy/types';

/**
 * The library follows the workspace, and a write lands where it was aimed.
 *
 * A switch must never paint one scope's rows under another, a reply that started in
 * the old scope must be dropped, and a write carries the scope its editor captured
 * even when the workspace has moved on since.
 */

const listTranslationContexts = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>());
const saveTranslationContext = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>());
vi.mock('@/clients/api-client', () => ({
  listTranslationContexts: (...args: unknown[]) => listTranslationContexts(...args),
  saveTranslationContext: (...args: unknown[]) => saveTranslationContext(...args),
  deleteTranslationContext: vi.fn(),
}));

const { useTranslationContexts } = await import('./use-translation-contexts');
const { WorkspaceTestHost } = await import('@/components/workspace/workspace-provider');
type HostValue = Parameters<typeof WorkspaceTestHost>[0]['value'];

const TEAM: TeamSummary = {
  id: 'c' + 'a'.repeat(24),
  name: 'Cardiology unit',
  role: 'member',
  memberCount: 3,
  createdAt: '2026-11-14T00:00:00.000Z',
};
const IN_TEAM: HostValue = { workspace: { kind: 'team', team: TEAM } };
const PERSONAL: HostValue = { workspace: { kind: 'personal' } };

const context = (id: string): TranslationContext => ({
  id,
  name: id,
  topic: null,
  hotwords: [],
  glossary: [],
  style: null,
  glossaryId: null,
  linkedGlossaryId: null,
  linkedGlossaryName: null,
  updatedAt: '2026-11-15T00:00:00.000Z',
});
const BODY = { name: 'x', topic: null, hotwords: [], glossary: [], style: null, glossaryId: null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useTranslationContexts>;
const reloadTeams = vi.fn(async () => {});

function Probe() {
  const value = useTranslationContexts();
  React.useEffect(() => {
    latest = value;
  });
  return null;
}

async function render(value: HostValue): Promise<void> {
  await act(async () => {
    root.render(
      <WorkspaceTestHost value={{ reloadTeams, ...value }}>
        <Probe />
      </WorkspaceTestHost>,
    );
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  listTranslationContexts.mockReset();
  saveTranslationContext.mockReset();
  reloadTeams.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useTranslationContexts — scope', () => {
  it("drops the old team's reply and its write's reload after a switch to personal", async () => {
    const teamList = deferred<unknown>();
    const save = deferred<unknown>();
    listTranslationContexts.mockImplementation((teamId?: unknown) =>
      teamId === TEAM.id ? teamList.promise : Promise.resolve({ contexts: [context('mine')] }),
    );
    saveTranslationContext.mockReturnValue(save.promise);

    await render(IN_TEAM);
    let saving: Promise<void> = Promise.resolve();
    act(() => {
      saving = latest.save('new', BODY, TEAM.id);
    });
    await render(PERSONAL);
    await act(async () => {
      teamList.resolve({ contexts: [context('theirs')] });
      save.resolve(undefined);
      await saving;
    });

    expect(saveTranslationContext).toHaveBeenCalledWith('new', BODY, TEAM.id);
    expect(latest.teamId).toBeUndefined();
    expect(latest.contexts.map((c) => c.id)).toEqual(['mine']);
  });

  it('sends a write to the scope it was given, not the live one', async () => {
    listTranslationContexts.mockResolvedValue({ contexts: [] });
    saveTranslationContext.mockResolvedValue(undefined);

    await render(PERSONAL);
    await act(async () => {
      await latest.save('new', BODY, TEAM.id);
    });

    expect(saveTranslationContext).toHaveBeenCalledWith('new', BODY, TEAM.id);
  });

  it('fetches nothing and reports failed while a failed team list leaves it resolving', async () => {
    await render({ workspace: { kind: 'resolving' }, teamsStatus: 'failed' });

    expect(listTranslationContexts).not.toHaveBeenCalled();
    expect(latest.status).toBe('failed');
  });

  it.each([404, 403])('reloads the teams when the team list answers %i', async (status) => {
    listTranslationContexts.mockRejectedValue(
      new ApiClientError(
        { code: status === 404 ? 'NOT_FOUND' : 'FORBIDDEN', message: 'Refused.' },
        status,
      ),
    );

    await render(IN_TEAM);

    expect(reloadTeams).toHaveBeenCalled();
    expect(latest.status).toBe('failed');
  });

  it('marks team rows without canEdit as editable, and keeps a false one', async () => {
    listTranslationContexts.mockResolvedValue({
      contexts: [context('a'), { ...context('b'), canEdit: false }],
    });

    await render(IN_TEAM);

    expect(latest.contexts.map((c) => c.canEdit)).toEqual([true, false]);
  });

  it('reloads the teams and the list, and rethrows, when a team write answers 403', async () => {
    listTranslationContexts.mockResolvedValue({ contexts: [] });
    saveTranslationContext.mockRejectedValue(
      new ApiClientError({ code: 'FORBIDDEN', message: 'Forbidden.' }, 403),
    );
    await render(IN_TEAM);
    const listsBefore = listTranslationContexts.mock.calls.length;

    let failure: unknown;
    await act(async () => {
      await latest.save('new', BODY, TEAM.id).catch((err: unknown) => {
        failure = err;
      });
    });

    expect(failure).toBeInstanceOf(ApiClientError);
    expect(reloadTeams).toHaveBeenCalled();
    expect(listTranslationContexts.mock.calls.length).toBeGreaterThan(listsBefore);
  });

  it('retries by reloading the teams while the workspace resolves', async () => {
    await render({ workspace: { kind: 'resolving' }, teamsStatus: 'failed' });

    await act(async () => {
      await latest.retry();
    });

    expect(reloadTeams).toHaveBeenCalled();
    expect(listTranslationContexts).not.toHaveBeenCalled();
  });
});
