import { describe, expect, it, vi } from 'vitest';
import type { TranslationContext } from '@chatofy/types';

vi.mock('@/clients/api-client', () => ({ listAvailableTranslationContexts: vi.fn() }));

import { groupAvailable } from './use-available-translation-contexts';
import { resolveContext } from './use-translation-contexts';

/**
 * How the picker groups contexts, and the one id it must refuse to resolve.
 *
 * A reader in no team must get the flat list they had before teams existed, and
 * an id two teams both hold must resolve to nothing — resolving it by team order
 * would let a teammate plant a context under an id another member selected.
 */

const context = (id: string, name = id): TranslationContext => ({
  id,
  name,
  topic: null,
  hotwords: [],
  glossary: [],
  style: null,
  glossaryId: null,
  linkedGlossaryId: null,
  linkedGlossaryName: null,
  updatedAt: '2026-11-15T00:00:00.000Z',
});

const team = (teamId: string, contexts: TranslationContext[]) => ({
  teamId,
  name: `Team ${teamId}`,
  contexts,
});

describe('groupAvailable', () => {
  it('renders personal-only as one flat group', () => {
    const { groups } = groupAvailable({ personal: [context('p1')], teams: [] }, 'Personal');
    expect(groups).toEqual([{ key: 'personal', label: null, contexts: [context('p1')] }]);
  });

  it('labels each group once a team adds contexts', () => {
    const { groups } = groupAvailable(
      { personal: [context('p1')], teams: [team('t1', [context('c1')])] },
      'Personal',
    );
    expect(groups.map((group) => group.label)).toEqual(['Personal', 'Team t1']);
  });

  it('keeps a sole team group labelled', () => {
    const { groups } = groupAvailable(
      { personal: [], teams: [team('t1', [context('c1')])] },
      'Personal',
    );
    expect(groups).toEqual([{ key: 't1', label: 'Team t1', contexts: [context('c1')] }]);
  });

  it('keeps an id held by personal and a team only in personal', () => {
    const { groups, all } = groupAvailable(
      {
        personal: [context('x', 'mine')],
        teams: [team('t1', [context('x', 'theirs'), context('c1')])],
      },
      'Personal',
    );
    expect(groups[1]?.contexts.map((c) => c.id)).toEqual(['c1']);
    expect(resolveContext(all, 'x')?.name).toBe('mine');
  });

  it('resolves an id two teams hold to none', () => {
    const { groups, all } = groupAvailable(
      {
        personal: [context('p1')],
        teams: [team('t1', [context('dup'), context('c1')]), team('t2', [context('dup')])],
      },
      'Personal',
    );
    expect(groups.flatMap((group) => group.contexts.map((c) => c.id))).not.toContain('dup');
    expect(resolveContext(all, 'dup')).toBeNull();
  });

  it('drops an empty team', () => {
    const { groups } = groupAvailable(
      { personal: [context('p1')], teams: [team('t1', [])] },
      'Personal',
    );
    expect(groups.map((group) => group.key)).toEqual(['personal']);
  });

  it('orders all as personal, then teams in join order', () => {
    const { all } = groupAvailable(
      {
        personal: [context('p1')],
        teams: [team('t1', [context('c1')]), team('t2', [context('c2')])],
      },
      'Personal',
    );
    expect(all.map((c) => c.id)).toEqual(['p1', 'c1', 'c2']);
  });
});
