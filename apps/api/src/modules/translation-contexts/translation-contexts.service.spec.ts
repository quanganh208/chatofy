import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  CONTEXT_LIMITS,
  TEAM_LIMITS,
  type SaveTranslationContextRequest,
  type TranslationContext,
} from '@chatofy/types';
import { TranslationContextsService } from './translation-contexts.service';
import {
  mintTeamScope,
  personalScope,
  type LibraryScope,
} from '../../common/library-scope/library-scope';
import type { RemoveResult } from '../../common/library-scope/library-write-results';
import type { TranslationContextStore } from './interfaces/translation-context-store.interface';
import type { TeamAccessService } from '../teams/team-access.service';

/**
 * The half of the ceiling this service still decides, apart from HTTP.
 *
 * The arithmetic is the store's now — only it can count and insert in one
 * transaction — so there is nothing left here to assert about 19 versus 20. What
 * is left is the number the store is HELD to and what a refusal reads as, and
 * both of those are asserted on the call and on the exception rather than on a
 * double that would just be agreeing with itself.
 *
 * The case that the service reads NOTHING before the save is the one that keeps
 * the fix in place: a count taken out here is the read that let two concurrent
 * creates both pass, and re-adding one would look harmless.
 */

const body: SaveTranslationContextRequest = {
  name: 'Thesis defense',
  topic: null,
  hotwords: [],
  glossary: [],
  style: null,
  glossaryId: null,
};

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
  updatedAt: '2026-09-17T00:00:00.000Z',
});

/** A team scope as a member, minted here only because this is a unit spec. */
const TEAM = mintTeamScope('owner-1', 'team-1', 'member');

type Refused = 'limit' | 'glossary-missing' | 'forbidden' | 'id-in-use';

/** A store that writes whatever it is given, unless `refuse` names a refusal. */
function makeService(
  options: {
    refuse?: Refused;
    memberships?: Awaited<ReturnType<TeamAccessService['memberships']>>;
  } = {},
) {
  const list = vi.fn(
    async (_scope: LibraryScope) => [] as TranslationContext[],
  );
  const save = vi.fn(async (_owner: string, id: string) =>
    options.refuse === undefined
      ? { kind: 'saved' as const, value: context(id) }
      : { kind: options.refuse },
  );
  const remove = vi.fn(async (): Promise<RemoveResult> => 'removed');
  const store = { list, save, remove } as unknown as TranslationContextStore;
  const memberships = vi.fn(async () => options.memberships ?? []);
  const access = { memberships } as unknown as TeamAccessService;
  return {
    service: new TranslationContextsService(store, access),
    list,
    save,
    remove,
    memberships,
  };
}

describe('TranslationContextsService', () => {
  it('holds the store to the ceiling the contract states', async () => {
    const { service, save } = makeService();

    await service.save(personalScope('owner-1'), 'ctx-new', body);

    expect(save).toHaveBeenCalledWith(
      personalScope('owner-1'),
      'ctx-new',
      body,
      CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER,
    );
  });

  it('reads nothing of its own before the save', async () => {
    // The whole reason the ceiling moved into the store's transaction. A count
    // or a list taken here is a read with nothing holding it, and two creates
    // fired together would both be told there is room.
    const { service, list, save } = makeService();

    await service.save(personalScope('owner-1'), 'ctx-new', body);

    expect(list).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('turns a refused write into a 409 naming the ceiling', async () => {
    const { service } = makeService({ refuse: 'limit' });

    const refusal = service.save(personalScope('owner-1'), 'ctx-new', body);

    await expect(refusal).rejects.toBeInstanceOf(ConflictException);
    // The number reaches the user, so it has to come from the contract rather
    // than be written into the sentence by hand.
    await expect(refusal).rejects.toThrow(
      String(CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER),
    );
  });

  it('turns a link to a glossary the caller does not hold into a 400', async () => {
    const { service } = makeService({ refuse: 'glossary-missing' });

    await expect(
      service.save(personalScope('owner-1'), 'ctx-new', body),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns the written context untouched when the store wrote one', async () => {
    // Nothing is re-checked on top of the store's answer: a second gate here
    // would refuse a replace the store already decided was legal.
    const { service } = makeService();

    await expect(
      service.save(personalScope('owner-1'), 'ctx-3', body),
    ).resolves.toEqual(context('ctx-3'));
  });

  it('discards whether a delete removed anything', async () => {
    // The route is 204 either way, so an id that was never there and one
    // belonging to someone else are indistinguishable to the caller.
    const { service, remove } = makeService();
    remove.mockResolvedValue('absent');

    await expect(
      service.remove(personalScope('owner-1'), 'ctx-absent'),
    ).resolves.toBeUndefined();
  });

  it('holds a team save to the team ceiling', async () => {
    const { service, save } = makeService();

    await service.save(TEAM, 'ctx-new', body);

    expect(save).toHaveBeenCalledWith(
      TEAM,
      'ctx-new',
      body,
      TEAM_LIMITS.MAX_CONTEXTS_PER_TEAM,
    );
  });

  it('turns a non-author member write into a 403', async () => {
    const { service } = makeService({ refuse: 'forbidden' });

    await expect(service.save(TEAM, 'ctx-1', body)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('turns a team create under an id used elsewhere into a 409', async () => {
    const { service } = makeService({ refuse: 'id-in-use' });

    const refusal = service.save(TEAM, 'ctx-1', body);

    await expect(refusal).rejects.toBeInstanceOf(ConflictException);
    await expect(refusal).rejects.toThrow('already used');
  });

  it('turns a non-author member delete into a 403', async () => {
    const { service, remove } = makeService();
    remove.mockResolvedValue('forbidden');

    await expect(service.remove(TEAM, 'ctx-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lists personal and every team in membership order, in one pass', async () => {
    const teamA = mintTeamScope('owner-1', 'team-a', 'member');
    const teamB = mintTeamScope('owner-1', 'team-b', 'admin');
    const summary = (id: string, name: string) =>
      ({ id, name }) as Awaited<
        ReturnType<TeamAccessService['memberships']>
      >[number]['team'];
    const { service, list, memberships } = makeService({
      memberships: [
        { scope: teamA, team: summary('team-a', 'Alpha') },
        { scope: teamB, team: summary('team-b', 'Beta') },
      ],
    });
    list.mockImplementation(async (scope: LibraryScope) => [
      context(scope.kind === 'team' ? `in-${scope.teamId}` : 'mine'),
    ]);

    await expect(service.listAvailable('owner-1')).resolves.toEqual({
      personal: [context('mine')],
      teams: [
        { teamId: 'team-a', name: 'Alpha', contexts: [context('in-team-a')] },
        { teamId: 'team-b', name: 'Beta', contexts: [context('in-team-b')] },
      ],
    });
    expect(memberships).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(3);
  });
});
