import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { TeamAccessService } from './team-access.service';

function makeService() {
  const findUnique = vi.fn();
  const findMany = vi.fn();
  const prisma = {
    teamMember: { findUnique, findMany },
  } as unknown as PrismaService;
  return { service: new TeamAccessService(prisma), findUnique, findMany };
}

const teamRow = (id: string) => ({
  id,
  name: id,
  createdAt: new Date('2026-11-14T00:00:00.000Z'),
  _count: { members: 2 },
});

describe('TeamAccessService', () => {
  it('answers 404 to a non-member, so the team stays hidden', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue(null);
    await expect(service.resolve('u', 't')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('answers 404 to a stored role this build cannot read', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({ role: 'weird' });
    await expect(service.resolve('u', 't')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('answers 403 to a member below the required role', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({ role: 'member' });
    await expect(service.resolve('u', 't', 'admin')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('mints a team scope for an admin when admin is required', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({ role: 'admin' });
    await expect(service.resolve('u', 't', 'admin')).resolves.toMatchObject({
      kind: 'team',
      userId: 'u',
      teamId: 't',
      role: 'admin',
    });
  });

  it('lets the owner through an owner-only check', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({ role: 'owner' });
    await expect(service.resolve('u', 't', 'owner')).resolves.toMatchObject({
      role: 'owner',
    });
  });

  it('lists memberships oldest first, skipping an unreadable role', async () => {
    const { service, findMany } = makeService();
    findMany.mockResolvedValue([
      { teamId: 'a', role: 'owner', team: teamRow('a') },
      { teamId: 'x', role: 'weird', team: teamRow('x') },
      { teamId: 'b', role: 'member', team: teamRow('b') },
    ]);

    const result = await service.memberships('u');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u' },
        orderBy: { joinedAt: 'asc' },
      }),
    );
    expect(result.map((m) => m.team.id)).toEqual(['a', 'b']);
    expect(result.map((m) => m.scope.role)).toEqual(['owner', 'member']);
    expect(result[0]?.team).toEqual({
      id: 'a',
      name: 'a',
      role: 'owner',
      memberCount: 2,
      createdAt: '2026-11-14T00:00:00.000Z',
    });
  });
});
