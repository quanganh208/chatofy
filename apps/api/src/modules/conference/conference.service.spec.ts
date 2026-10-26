import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conferenceRoomIdSchema } from '@chatofy/types';
import { InMemoryConferencePrisma } from '../../../test/utils/in-memory-conference-prisma';
import type { ConferenceRoomRegistry } from './conference-room-registry.service';
import { ConferenceService } from './conference.service';

describe('ConferenceService', () => {
  let prisma: InMemoryConferencePrisma;
  let endRoom: ReturnType<typeof vi.fn>;
  let service: ConferenceService;

  beforeEach(() => {
    prisma = new InMemoryConferencePrisma();
    endRoom = vi.fn();
    service = new ConferenceService(prisma.asPrismaService(), {
      endRoom,
    } as unknown as ConferenceRoomRegistry);
  });

  it('creates a waiting room owned by the caller, with a cuid id and an ISO createdAt', async () => {
    const room = await service.create('alice', { title: 'Standup' });

    expect(conferenceRoomIdSchema.safeParse(room.id).success).toBe(true);
    expect(room).toMatchObject({
      status: 'waiting',
      ownerId: 'alice',
      title: 'Standup',
    });
    expect(new Date(room.createdAt).toISOString()).toBe(room.createdAt);
  });

  it('lists only rooms the caller owns or has joined', async () => {
    const own = await service.create('alice', {});
    const joined = prisma.seed({ ownerId: 'bob' });
    prisma.seed({ ownerId: 'carol' });
    await prisma.conferenceParticipant.upsert({
      where: {
        conferenceId_userId: { conferenceId: joined.id, userId: 'alice' },
      },
      create: {
        conferenceId: joined.id,
        userId: 'alice',
        displayName: 'Alice',
        sourceLanguage: 'vi',
        status: 'joined',
      },
      update: {},
    });

    const list = await service.list('alice', {});

    expect(list.total).toBe(2);
    expect(list.conferences.map((c) => c.id).sort()).toStrictEqual(
      [own.id, joined.id].sort(),
    );
  });

  it('answers 404 to a caller who neither owns nor joined the room', async () => {
    const room = await service.create('alice', {});

    await expect(service.findOne(room.id, 'mallory')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.findOne(room.id, 'alice')).resolves.toMatchObject({
      id: room.id,
      participants: [],
    });
  });

  it('refuses to end a room for anyone but its owner, and leaves it running', async () => {
    const room = await service.create('alice', {});

    await expect(service.end(room.id, 'bob')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.conferences.get(room.id)?.status).toBe('waiting');
    expect(endRoom).not.toHaveBeenCalled();
  });

  it('ends the room for its owner: status ended, endedAt set, live room torn down', async () => {
    const room = await service.create('alice', {});

    const ended = await service.end(room.id, 'alice');

    expect(ended.status).toBe('ended');
    expect(prisma.conferences.get(room.id)?.endedAt).toBeInstanceOf(Date);
    expect(endRoom).toHaveBeenCalledWith(room.id);
  });

  it('answers 404 when ending a room that does not exist', async () => {
    await expect(service.end('cmissing0000', 'alice')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reports joinability from the row, and activates a waiting room once', async () => {
    const room = await service.create('alice', {});
    const finished = prisma.seed({ ownerId: 'alice', status: 'ended' });

    await expect(service.joinableStatus('cnotminted00')).resolves.toBe(
      'room_not_found',
    );
    await expect(service.joinableStatus(finished.id)).resolves.toBe(
      'room_ended',
    );
    await expect(service.joinableStatus(room.id)).resolves.toBe('joinable');

    await service.markActive(room.id);
    const startedAt = prisma.conferences.get(room.id)?.startedAt;
    expect(prisma.conferences.get(room.id)?.status).toBe('active');
    expect(startedAt).toBeInstanceOf(Date);

    await service.markActive(room.id);
    expect(prisma.conferences.get(room.id)?.startedAt).toBe(startedAt);
  });
});
