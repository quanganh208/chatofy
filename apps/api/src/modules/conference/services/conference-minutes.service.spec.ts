import { describe, expect, it, vi } from 'vitest';
import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  ProviderConnectionError,
  ProviderResponseError,
  ProviderRegistry,
  type MeetingMinutesDraft,
  type SummarizationProvider,
} from '@chatofy/ai-providers';
import { MINUTES_LIMITS, type ConferenceMinutes } from '@chatofy/types';
import { InMemoryConferencePrisma } from '../../../../test/utils/in-memory-conference-prisma';
import type { Env } from '../../../config/env.schema';
import { MinutesSummarizer } from '../../minutes/minutes-summarizer.service';
import type { ConferenceMinutesStore } from '../stores/prisma-conference-minutes.store';
import { ConferenceMinutesService } from './conference-minutes.service';

const draft: MeetingMinutesDraft = {
  summary: 'They agreed on the budget.',
  keyPoints: ['budget'],
  decisions: ['ship it'],
  actionItems: [{ description: 'send the deck', owner: 'Bob', dueDate: null }],
  model: 'gemini-3.5-flash',
};

/**
 * A room owned by `owner` with `bob` as a (non-owner) participant who said one
 * thing, wired to a fake summarizer and an in-memory minutes store.
 *
 * The store models the FK the real one has: a write for a conference that no
 * longer exists throws, which is what makes the "room gone mid-generation"
 * case real.
 */
function setup(summarize: SummarizationProvider['summarize']) {
  const prisma = new InMemoryConferencePrisma();
  const stored = new Map<string, ConferenceMinutes>();
  const store: ConferenceMinutesStore = {
    get: (id) => Promise.resolve(stored.get(id) ?? null),
    put: (minutes) => {
      if (!prisma.conferences.has(minutes.conferenceId)) {
        return Promise.reject(new Error('Foreign key constraint violated'));
      }
      stored.set(minutes.conferenceId, minutes);
      return Promise.resolve(minutes);
    },
  };
  const registry = new ProviderRegistry();
  registry.register('summarization', {
    name: 'gemini',
    create: () => ({ name: 'gemini', summarize }),
  });
  const config = { get: () => 'test-key' } as unknown as ConfigService<
    Env,
    true
  >;
  const service = new ConferenceMinutesService(
    prisma.asPrismaService(),
    new MinutesSummarizer(config, registry),
    store,
  );

  const room = prisma.seed({ ownerId: 'owner', status: 'ended' });
  const join = async (userId: string, displayName: string | null) => {
    const { id } = await prisma.conferenceParticipant.upsert({
      where: { conferenceId_userId: { conferenceId: room.id, userId } },
      create: {
        conferenceId: room.id,
        userId,
        displayName,
        sourceLanguage: 'en',
        status: 'left',
      },
      update: {},
    });
    return id;
  };
  const say = (participantId: string, sourceText: string) =>
    prisma.conferenceTurn.create({
      data: {
        conferenceId: room.id,
        participantId,
        sourceLanguage: 'en',
        sourceText,
        searchText: null,
        translations: {},
      },
    });

  return { prisma, service, store, room, join, say };
}

describe('ConferenceMinutesService', () => {
  describe('access — the room detail rule, owner or any participant', () => {
    it('lets a participant who is not the owner generate and read the minutes', async () => {
      const { service, room, join, say } = setup(
        vi.fn().mockResolvedValue(draft),
      );
      await say(await join('bob', 'Bob'), 'let us ship');

      const generated = await service.generate(room.id, 'bob', {});

      expect(generated).toMatchObject({
        conferenceId: room.id,
        status: 'ready',
        summary: 'They agreed on the budget.',
      });
      await expect(service.get(room.id, 'bob')).resolves.toEqual(generated);
      // One copy per room: the owner reads the copy a participant generated.
      await expect(service.get(room.id, 'owner')).resolves.toEqual(generated);
    });

    it('404s a non-participant on both routes, before any provider call', async () => {
      const summarize = vi.fn().mockResolvedValue(draft);
      const { service, room, join, say } = setup(summarize);
      await say(await join('bob', 'Bob'), 'let us ship');
      await service.generate(room.id, 'bob', {});
      summarize.mockClear();

      await expect(service.get(room.id, 'mallory')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.generate(room.id, 'mallory', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(summarize).not.toHaveBeenCalled();
    });

    it('404s a room id that does not exist', async () => {
      const { service } = setup(vi.fn().mockResolvedValue(draft));

      await expect(service.get('cnope', 'owner')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('answers null to a participant when nobody has generated minutes yet', async () => {
      const { service, room, join } = setup(vi.fn().mockResolvedValue(draft));
      await join('bob', 'Bob');

      await expect(service.get(room.id, 'bob')).resolves.toBeNull();
    });
  });

  describe('the transcript', () => {
    it('labels each turn with its speaker, in the order spoken, in the requested language', async () => {
      const summarize = vi.fn().mockResolvedValue(draft);
      const { service, room, join, say } = setup(summarize);
      const alice = await join('owner', 'Alice');
      const guest = await join('guest', null);
      await say(alice, 'hello');
      await say(guest, '   ');
      await say(guest, 'xin chào');
      await say(alice, ' bye ');

      await service.generate(room.id, 'owner', { language: 'vi' });

      expect(summarize).toHaveBeenCalledWith({
        // The blank turn is dropped; a speaker with no name is still labelled.
        transcript: 'Alice: hello\nSpeaker: xin chào\nAlice: bye',
        language: 'vi',
      });
    });

    it('refuses a room where nothing was said, before any provider call', async () => {
      const summarize = vi.fn().mockResolvedValue(draft);
      const { service, room, join, say } = setup(summarize);
      await say(await join('bob', 'Bob'), '  ');

      await expect(service.generate(room.id, 'bob', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(summarize).not.toHaveBeenCalled();
    });

    it('refuses a transcript over the prompt ceiling, before any provider call', async () => {
      const summarize = vi.fn().mockResolvedValue(draft);
      const { service, room, join, say } = setup(summarize);
      const bob = await join('bob', 'Bob');
      for (let i = 0; i < 30; i++) await say(bob, 'x'.repeat(3_000));
      expect(30 * 3_000).toBeGreaterThan(MINUTES_LIMITS.MAX_TOTAL_CHARS);

      await expect(service.generate(room.id, 'bob', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(summarize).not.toHaveBeenCalled();
    });
  });

  describe('failure semantics — the same as the conversation minutes', () => {
    it('persists a failed record and rethrows 503 when the pool is unavailable', async () => {
      const { service, store, room, join, say } = setup(
        vi.fn().mockRejectedValue(new ProviderConnectionError('cooling down')),
      );
      await say(await join('bob', 'Bob'), 'let us ship');

      await expect(service.generate(room.id, 'bob', {})).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await expect(store.get(room.id)).resolves.toMatchObject({
        status: 'failed',
      });
    });

    it('keeps readable minutes when a regenerate fails, rather than emptying them', async () => {
      const summarize = vi
        .fn()
        .mockResolvedValueOnce(draft)
        .mockRejectedValue(new ProviderConnectionError('cooling down'));
      const { service, room, join, say } = setup(summarize);
      await say(await join('bob', 'Bob'), 'let us ship');

      await service.generate(room.id, 'bob', {});
      // A different participant presses Regenerate and meets an outage.
      await expect(
        service.generate(room.id, 'owner', {}),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      await expect(service.get(room.id, 'owner')).resolves.toMatchObject({
        status: 'ready',
        summary: 'They agreed on the budget.',
      });
    });

    it('rethrows 502 when the model returns an unusable response', async () => {
      const { service, room, join, say } = setup(
        vi.fn().mockRejectedValue(new ProviderResponseError('non-JSON')),
      );
      await say(await join('bob', 'Bob'), 'let us ship');

      await expect(service.generate(room.id, 'bob', {})).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });

    it('keeps the provider error when the failed record cannot be written', async () => {
      const holder: { drop?: () => void } = {};
      const { prisma, service, room, join, say } = setup(
        vi.fn().mockImplementation(() => {
          holder.drop?.();
          throw new ProviderConnectionError('cooling down');
        }),
      );
      holder.drop = () => prisma.conferences.delete(room.id);
      await say(await join('bob', 'Bob'), 'let us ship');

      await expect(service.generate(room.id, 'bob', {})).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('lets any participant regenerate, replacing the stored copy', async () => {
      const summarize = vi
        .fn()
        .mockResolvedValueOnce(draft)
        .mockResolvedValueOnce({ ...draft, summary: 'Second pass.' });
      const { service, room, join, say } = setup(summarize);
      await say(await join('bob', 'Bob'), 'let us ship');

      const first = await service.generate(room.id, 'bob', {});
      const second = await service.generate(room.id, 'owner', {
        language: 'en',
      });

      expect(second.summary).toBe('Second pass.');
      expect(second.actionItems[0]!.id).not.toBe(first.actionItems[0]!.id);
      await expect(service.get(room.id, 'bob')).resolves.toEqual(second);
    });
  });
});
