import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import { mintTeamScope } from '../../common/library-scope/library-scope';
import type { TeamAccessService } from './team-access.service';
import { TeamMembersService } from './team-members.service';

/**
 * Member privacy in the list, with an avatar base configured — the case the
 * db-e2e suite cannot reach, because its environment serves no avatars.
 */
function makeService() {
  const prisma = {
    teamMember: {
      findMany: vi.fn(async () => [
        {
          id: 'm-self',
          userId: 'user-self',
          role: 'member',
          joinedAt: new Date(0),
        },
        {
          id: 'm-other',
          userId: 'user-other',
          role: 'admin',
          joinedAt: new Date(0),
        },
      ]),
    },
    user: {
      findMany: vi.fn(async () => [
        {
          id: 'user-self',
          name: 'Me',
          email: 'me@example.com',
          avatarKey: 'avatars/user-self/a.png',
        },
        {
          id: 'user-other',
          name: 'Them',
          email: 'them@example.com',
          avatarKey: 'avatars/user-other/b.png',
        },
      ]),
    },
  } as unknown as PrismaService;
  const config = {
    get: vi.fn(() => 'https://cdn.example.com/'),
  } as unknown as ConfigService<never, true>;
  return new TeamMembersService(prisma, {} as TeamAccessService, config);
}

describe('TeamMembersService.list', () => {
  it("gives only the viewer's own row an avatar, because a key embeds the user id", async () => {
    const service = makeService();
    const members = await service.list(
      mintTeamScope('user-self', 't', 'member'),
    );

    expect(members.find((m) => m.isSelf)?.avatarUrl).toBe(
      'https://cdn.example.com/avatars/user-self/a.png',
    );
    expect(members.find((m) => !m.isSelf)?.avatarUrl).toBeNull();
    expect(JSON.stringify(members)).not.toContain('user-other');
  });

  it('shows a plain member their own email but no teammate email', async () => {
    const service = makeService();
    const members = await service.list(
      mintTeamScope('user-self', 't', 'member'),
    );

    expect(members.find((m) => m.isSelf)?.email).toBe('me@example.com');
    expect(members.find((m) => !m.isSelf)?.email).toBeNull();
  });
});
