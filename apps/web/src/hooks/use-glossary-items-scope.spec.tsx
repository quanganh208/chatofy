// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@chatofy/api-client';

/**
 * Terms come from the scope their glossary was listed in, and a refused team call
 * tells the page that the list it drew from is stale.
 */

const listGlossaryItems = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>());
const addGlossaryItem = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>());
vi.mock('@/clients/api-client', () => ({
  listGlossaryItems: (...args: unknown[]) => listGlossaryItems(...args),
  addGlossaryItem: (...args: unknown[]) => addGlossaryItem(...args),
  deleteGlossaryItem: vi.fn(),
}));

const { useGlossaryItems } = await import('./use-glossary-items');
const { WorkspaceTestHost } = await import('@/components/workspace/workspace-provider');

const TEAM_ID = 'c' + 'a'.repeat(24);
const BODY = {
  clientId: '00000000-0000-4000-8000-000000000001',
  original: 'troponin',
  translation: 'troponin',
  targetLang: 'en' as const,
  notes: null,
};
const refused = (status: number) =>
  new ApiClientError(
    { code: status === 404 ? 'NOT_FOUND' : 'FORBIDDEN', message: 'Refused.' },
    status,
  );

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useGlossaryItems>;
const reloadTeams = vi.fn(async () => {});
const onListStale = vi.fn();

function Probe() {
  const value = useGlossaryItems('g-1', TEAM_ID, onListStale);
  React.useEffect(() => {
    latest = value;
  });
  return null;
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(
      <WorkspaceTestHost value={{ reloadTeams }}>
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
  listGlossaryItems.mockReset();
  addGlossaryItem.mockReset();
  reloadTeams.mockClear();
  onListStale.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useGlossaryItems — team scope', () => {
  it("reads the terms from the glossary's team", async () => {
    listGlossaryItems.mockResolvedValue({ items: [] });
    await render();
    expect(listGlossaryItems).toHaveBeenCalledWith('g-1', TEAM_ID);
    expect(latest.status).toBe('ready');
  });

  it('reloads the teams and the glossary list when a team write answers 403', async () => {
    listGlossaryItems.mockResolvedValue({ items: [] });
    addGlossaryItem.mockRejectedValue(refused(403));
    await render();

    let failure: unknown;
    await act(async () => {
      await latest.addItem(BODY, TEAM_ID).catch((err: unknown) => {
        failure = err;
      });
    });

    expect(failure).toBeInstanceOf(ApiClientError);
    expect(reloadTeams).toHaveBeenCalled();
    expect(onListStale).toHaveBeenCalled();
  });

  it('reloads the teams when a team read answers 404', async () => {
    listGlossaryItems.mockRejectedValue(refused(404));
    await render();
    expect(reloadTeams).toHaveBeenCalled();
    expect(latest.status).toBe('failed');
  });
});
