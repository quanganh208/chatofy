import type { MeetingMinutes } from '@chatofy/types';
import type { PrismaService } from '../../../prisma/prisma.service';
import { PrismaMinutesStore } from './prisma-minutes.store';

function fakePrisma(overrides: { findUnique?: jest.Mock; upsert?: jest.Mock }) {
  const meetingMinutes = {
    findUnique: overrides.findUnique ?? jest.fn(),
    upsert: overrides.upsert ?? jest.fn().mockResolvedValue({}),
  };
  return {
    prisma: { meetingMinutes } as unknown as PrismaService,
    meetingMinutes,
  };
}

const minutes: MeetingMinutes = {
  sessionId: 's1',
  status: 'ready',
  summary: 'A short meeting.',
  keyPoints: ['k1'],
  decisions: ['d1'],
  actionItems: [
    { id: 'a1', description: 'first', owner: 'Alice', dueDate: 'Friday' },
    { id: 'a2', description: 'second', owner: null, dueDate: null },
  ],
  generatedAt: '2026-08-30T00:00:00.000Z',
  model: 'gemini-3.5-flash',
};

describe('PrismaMinutesStore', () => {
  it('reads by the compound (owner, session) key and maps the row to the domain shape', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      sessionId: 's1',
      status: 'ready',
      summary: 'A short meeting.',
      keyPoints: ['k1'],
      decisions: ['d1'],
      generatedAt: new Date('2026-08-30T00:00:00.000Z'),
      model: 'gemini-3.5-flash',
      actionItems: [
        {
          id: 'a1',
          description: 'first',
          owner: 'Alice',
          dueDate: 'Friday',
          position: 0,
        },
      ],
    });
    const { prisma, meetingMinutes } = fakePrisma({ findUnique });
    const store = new PrismaMinutesStore(prisma);

    const result = await store.get('u1', 's1');

    expect(meetingMinutes.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId_sessionId: { ownerId: 'u1', sessionId: 's1' } },
      }),
    );
    // Domain shape only — no ownerId, no join ids/position leak out.
    expect(result).toEqual({
      sessionId: 's1',
      status: 'ready',
      summary: 'A short meeting.',
      keyPoints: ['k1'],
      decisions: ['d1'],
      actionItems: [
        { id: 'a1', description: 'first', owner: 'Alice', dueDate: 'Friday' },
      ],
      generatedAt: '2026-08-30T00:00:00.000Z',
      model: 'gemini-3.5-flash',
    });
  });

  it('returns null when the owner has no minutes for the session', async () => {
    const { prisma } = fakePrisma({
      findUnique: jest.fn().mockResolvedValue(null),
    });
    const store = new PrismaMinutesStore(prisma);
    await expect(store.get('u1', 'missing')).resolves.toBeNull();
  });

  it('upserts on the compound key and replaces action items with positions', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const { prisma } = fakePrisma({ upsert });
    const store = new PrismaMinutesStore(prisma);

    const returned = await store.put('u1', minutes);

    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0]![0] as {
      where: { ownerId_sessionId: { ownerId: string; sessionId: string } };
      create: { generatedAt: Date | null; actionItems: { create: unknown[] } };
      update: { actionItems: { deleteMany: unknown; create: unknown[] } };
    };

    expect(arg.where).toEqual({
      ownerId_sessionId: { ownerId: 'u1', sessionId: 's1' },
    });
    // ISO string becomes a Date column value.
    expect(arg.create.generatedAt).toBeInstanceOf(Date);
    // Positions assigned from order; ids preserved as minted.
    expect(arg.create.actionItems.create).toEqual([
      {
        id: 'a1',
        description: 'first',
        owner: 'Alice',
        dueDate: 'Friday',
        position: 0,
      },
      {
        id: 'a2',
        description: 'second',
        owner: null,
        dueDate: null,
        position: 1,
      },
    ]);
    // On update the whole set is replaced, not merged.
    expect(arg.update.actionItems.deleteMany).toEqual({});
    // Returns the input unchanged (it already is what was stored).
    expect(returned).toBe(minutes);
  });

  it('stores a null generatedAt for a failed record', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const { prisma } = fakePrisma({ upsert });
    const store = new PrismaMinutesStore(prisma);

    await store.put('u1', {
      ...minutes,
      status: 'failed',
      generatedAt: null,
      actionItems: [],
    });

    const arg = upsert.mock.calls[0]![0] as {
      create: { generatedAt: Date | null };
    };
    expect(arg.create.generatedAt).toBeNull();
  });
});
