import { NotFoundException } from '@nestjs/common';
import type { MeetingMinutes } from '@chatofy/types';
import type { PrismaService } from '../../../prisma/prisma.service';
import { PrismaMinutesStore } from './prisma-minutes.store';

/**
 * The ownership resolution, mostly.
 *
 * `MeetingMinutes` is keyed by the conversation's server cuid while every URL
 * carries the client-minted id, so the shortest query that compiles is an
 * ownership-free read of anybody's minutes. These assert the two-step lookup
 * happens and that the OWNER reaches the conversation query — a store that
 * skipped it would still pass a "returns null for a missing id" test.
 */

/** The conversation row the resolution step returns, or null for "not yours". */
function fakePrisma(options: {
  conversation?: { id: string } | null;
  findUnique?: jest.Mock;
  upsert?: jest.Mock;
}) {
  const conversationFindUnique = jest
    .fn()
    .mockResolvedValue(
      options.conversation === undefined
        ? { id: 'cuid-1' }
        : options.conversation,
    );
  const meetingMinutes = {
    findUnique: options.findUnique ?? jest.fn().mockResolvedValue(null),
    upsert: options.upsert ?? jest.fn().mockResolvedValue({}),
  };
  return {
    prisma: {
      conversation: { findUnique: conversationFindUnique },
      meetingMinutes,
    } as unknown as PrismaService,
    conversationFindUnique,
    meetingMinutes,
  };
}

const minutes: MeetingMinutes = {
  conversationId: 'client-1',
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
  it('resolves the conversation by (owner, clientId) before reading a minutes row', async () => {
    const findUnique = jest.fn().mockResolvedValue({
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
    const { prisma, conversationFindUnique, meetingMinutes } = fakePrisma({
      findUnique,
    });
    const store = new PrismaMinutesStore(prisma);

    const result = await store.get('u1', 'client-1');

    // The owner is on the CONVERSATION query — this is the whole ownership check.
    expect(conversationFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId_clientId: { ownerId: 'u1', clientId: 'client-1' } },
      }),
    );
    // And the minutes row is keyed by the resolved cuid, never by the route param.
    expect(meetingMinutes.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: 'cuid-1' } }),
    );
    // Domain shape only, carrying the CLIENT id back — no cuid, no ownerId, no
    // join ids or positions leak out.
    expect(result).toEqual({
      conversationId: 'client-1',
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

  it('never looks for a minutes row when the caller does not own the conversation', async () => {
    const { prisma, meetingMinutes } = fakePrisma({ conversation: null });
    const store = new PrismaMinutesStore(prisma);

    await expect(store.get('u2', 'client-1')).resolves.toBeNull();
    // Not "returned null after reading it" — it must not be read at all.
    expect(meetingMinutes.findUnique).not.toHaveBeenCalled();
  });

  it('returns null when the conversation exists but has no minutes', async () => {
    const { prisma } = fakePrisma({
      findUnique: jest.fn().mockResolvedValue(null),
    });
    const store = new PrismaMinutesStore(prisma);
    await expect(store.get('u1', 'client-1')).resolves.toBeNull();
  });

  it('upserts on the resolved conversation and replaces action items with positions', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const { prisma } = fakePrisma({ upsert });
    const store = new PrismaMinutesStore(prisma);

    const returned = await store.put('u1', minutes);

    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0]![0] as {
      where: { conversationId: string };
      create: { generatedAt: Date | null; actionItems: { create: unknown[] } };
      update: { actionItems: { deleteMany: unknown; create: unknown[] } };
    };

    expect(arg.where).toEqual({ conversationId: 'cuid-1' });
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

  it('404s a write against a conversation the caller does not own', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const { prisma } = fakePrisma({ conversation: null, upsert });
    const store = new PrismaMinutesStore(prisma);

    await expect(store.put('u2', minutes)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // A write that reached Postgres would be an FK violation the caller sees as
    // a 500, which is the wrong answer for "that is not yours".
    expect(upsert).not.toHaveBeenCalled();
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
