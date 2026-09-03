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
import {
  MINUTES_LIMITS,
  type Conversation,
  type ConversationTurn,
  type GenerateMinutesRequest,
  type MeetingMinutes,
} from '@chatofy/types';
import type { Env } from '../../config/env.schema';
import type { ConversationStore } from '../conversations/interfaces/conversation-store.interface';
import type { MinutesStore } from './interfaces/minutes-store.interface';
import { MinutesService } from './minutes.service';

/**
 * Minimal in-process doubles, defined HERE rather than imported from
 * `test/utils/`: the unit tsconfig roots at `src/`, and a unit spec that reached
 * into the e2e helpers would couple the two suites for no gain. The e2e doubles
 * are richer because an e2e suite drives the routes; this one only needs the two
 * methods the service calls.
 */
function fakeStores() {
  const conversations = new Map<string, Conversation>();
  const minutes = new Map<string, MeetingMinutes>();
  const key = (ownerId: string, id: string) => `${ownerId}\n${id}`;

  const conversationStore: Pick<ConversationStore, 'get'> = {
    get: (ownerId, id) =>
      Promise.resolve(conversations.get(key(ownerId, id)) ?? null),
  };
  const minutesStore: MinutesStore = {
    get: (ownerId, id) =>
      Promise.resolve(
        conversations.has(key(ownerId, id))
          ? (minutes.get(key(ownerId, id)) ?? null)
          : null,
      ),
    put: (ownerId, artifact) => {
      const k = key(ownerId, artifact.conversationId);
      // The FK, modelled: a write against a conversation that is gone throws,
      // which is what makes the mid-generation deletion case real.
      if (!conversations.has(k)) {
        return Promise.reject(
          new NotFoundException(`no conversation ${artifact.conversationId}`),
        );
      }
      minutes.set(k, artifact);
      return Promise.resolve(artifact);
    },
  };
  return { conversations, conversationStore, minutesStore, key };
}

const draft: MeetingMinutesDraft = {
  summary: 'A short meeting.',
  keyPoints: ['point'],
  decisions: ['decided'],
  actionItems: [
    { description: 'do the thing', owner: 'Speaker 1', dueDate: null },
  ],
  model: 'gemini-3.5-flash',
};

const request: GenerateMinutesRequest = {};

const turn = (overrides: Partial<ConversationTurn> = {}): ConversationTurn => ({
  position: 0,
  speakerRole: 'speaker_a',
  speakerLabel: 'Speaker 1',
  sourceText: 'hello',
  displayText: null,
  targetText: 'xin chào',
  ...overrides,
});

/**
 * A service wired to a fake summarizer and the two in-memory doubles.
 *
 * Seeds one conversation for `u1` so the happy path has a transcript to load —
 * generation reads stored turns now, so a suite with no conversation would only
 * ever exercise the 404.
 */
function makeService(
  summarize: SummarizationProvider['summarize'],
  turns: ConversationTurn[] = [turn()],
) {
  const { conversations, conversationStore, minutesStore, key } = fakeStores();
  const registry = new ProviderRegistry();
  registry.register('summarization', {
    name: 'gemini',
    create: () => ({ name: 'gemini', summarize }),
  });
  const config = { get: () => 'test-key' } as unknown as ConfigService<
    Env,
    true
  >;
  const service = new MinutesService(
    config,
    registry,
    minutesStore,
    conversationStore as ConversationStore,
  );

  const seed = (ownerId: string, conversationId: string, rows = turns) => {
    conversations.set(key(ownerId, conversationId), {
      conversationId,
      direction: 'en_to_vi',
      startedAt: '2026-09-03T00:00:00.000Z',
      endedAt: '2026-09-03T00:10:00.000Z',
      turnCount: rows.length,
      preview: rows[0]?.sourceText ?? '',
      hasMinutes: false,
      turns: rows,
    });
    return Promise.resolve();
  };
  const forget = (ownerId: string, conversationId: string) =>
    conversations.delete(key(ownerId, conversationId));

  return { service, store: minutesStore, seed, forget };
}

describe('MinutesService', () => {
  it('maps a provider draft to a ready artifact with minted ids and a timestamp', async () => {
    const { service, store, seed } = makeService(
      jest.fn().mockResolvedValue(draft),
    );
    await seed('u1', 'c1');

    const minutes = await service.generate('u1', 'c1', request);

    expect(minutes.status).toBe('ready');
    expect(minutes.summary).toBe('A short meeting.');
    expect(minutes.model).toBe('gemini-3.5-flash');
    expect(minutes.generatedAt).toEqual(expect.any(String));
    expect(minutes.actionItems).toHaveLength(1);
    expect(minutes.actionItems[0]).toMatchObject({
      description: 'do the thing',
      owner: 'Speaker 1',
      dueDate: null,
    });
    // Minted, not taken from the model.
    expect(minutes.actionItems[0]!.id).toEqual(expect.any(String));
    // Persisted under the owner.
    await expect(store.get('u1', 'c1')).resolves.toEqual(minutes);
  });

  it('summarizes the repaired text the user read, not the raw recognizer output', async () => {
    const summarize = jest.fn().mockResolvedValue(draft);
    const { service, seed } = makeService(summarize);
    await seed('u1', 'c1', [
      turn({ sourceText: 'xin chao', displayText: 'xin chào' }),
    ]);

    await service.generate('u1', 'c1', request);

    expect(summarize).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: 'Speaker 1: xin chào' }),
    );
  });

  it('names an unattributed block from its role, so the prompt still has a speaker', async () => {
    const summarize = jest.fn().mockResolvedValue(draft);
    const { service, seed } = makeService(summarize);
    await seed('u1', 'c1', [
      turn({ speakerLabel: null, speakerRole: 'speaker_b', sourceText: 'hi' }),
    ]);

    await service.generate('u1', 'c1', request);

    expect(summarize).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: 'Speaker B: hi' }),
    );
  });

  it('404s a conversation the caller does not own, before any provider call', async () => {
    const summarize = jest.fn().mockResolvedValue(draft);
    const { service, seed } = makeService(summarize);
    await seed('u1', 'c1');

    await expect(service.generate('u2', 'c1', request)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // The point of resolving first: a billed call is never spent on a 404.
    expect(summarize).not.toHaveBeenCalled();
  });

  it('refuses a transcript over the prompt ceiling, before any provider call', async () => {
    const summarize = jest.fn().mockResolvedValue(draft);
    const { service, seed } = makeService(summarize);
    // Well under the STORAGE ceiling, well over the prompt one — the asymmetry
    // is the point: this conversation is saved and readable, just not billable.
    await seed(
      'u1',
      'c1',
      Array.from({ length: 30 }, (_, position) =>
        turn({ position, sourceText: 'x'.repeat(3_000) }),
      ),
    );
    expect(30 * 3_000).toBeGreaterThan(MINUTES_LIMITS.MAX_TOTAL_CHARS);

    await expect(service.generate('u1', 'c1', request)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(summarize).not.toHaveBeenCalled();
  });

  it('persists a failed record and rethrows 503 when the pool is unavailable', async () => {
    const { service, store, seed } = makeService(
      jest
        .fn()
        .mockRejectedValue(new ProviderConnectionError('all cooling down')),
    );
    await seed('u1', 'c1');

    await expect(service.generate('u1', 'c1', request)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(store.get('u1', 'c1')).resolves.toMatchObject({
      status: 'failed',
    });
  });

  it('keeps readable minutes when a regenerate fails, rather than emptying them', async () => {
    const summarize = jest
      .fn()
      .mockResolvedValueOnce(draft)
      .mockRejectedValue(new ProviderConnectionError('all cooling down'));
    const { service, store, seed } = makeService(summarize);
    await seed('u1', 'c1');

    await service.generate('u1', 'c1', request);
    await expect(service.generate('u1', 'c1', request)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    // The empty `failed` record would be indistinguishable from "never
    // generated" on the next read, and it is the only copy of a billed result.
    await expect(store.get('u1', 'c1')).resolves.toMatchObject({
      status: 'ready',
      summary: 'A short meeting.',
    });
  });

  it('rethrows 502 when the model returns an unusable response', async () => {
    const { service, seed } = makeService(
      jest
        .fn()
        .mockRejectedValue(new ProviderResponseError('non-JSON minutes')),
    );
    await seed('u1', 'c1');

    await expect(service.generate('u1', 'c1', request)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('keeps the provider error when the conversation is deleted mid-generation', async () => {
    // The failure-record write is against an FK now, so it can throw too. If it
    // escaped the catch block, `asHttpError` would never run and the real cause
    // — a provider fault on a call that may already have been billed — would be
    // replaced by an opaque 500.
    const holder: { forget?: () => void } = {};
    const { service, seed, forget } = makeService(
      jest.fn().mockImplementation(() => {
        holder.forget?.();
        throw new ProviderConnectionError('all cooling down');
      }),
    );
    holder.forget = () => forget('u1', 'c1');
    await seed('u1', 'c1');

    await expect(service.generate('u1', 'c1', request)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('scopes reads to the owner — another user cannot read the minutes', async () => {
    const { service, seed } = makeService(jest.fn().mockResolvedValue(draft));
    await seed('u1', 'c1');
    await service.generate('u1', 'c1', request);

    await expect(service.get('u2', 'c1')).resolves.toBeNull();
    await expect(service.get('u1', 'c1')).resolves.toMatchObject({
      status: 'ready',
    });
  });

  it('returns null for a conversation with no generated minutes', async () => {
    const { service, seed } = makeService(jest.fn().mockResolvedValue(draft));
    await seed('u1', 'never-generated');
    await expect(service.get('u1', 'never-generated')).resolves.toBeNull();
  });

  it('resolves the summarizer only once and keeps it warm', async () => {
    const summarize = jest.fn().mockResolvedValue(draft);
    const { service, seed } = makeService(summarize);
    await seed('u1', 'c1');
    await seed('u1', 'c2');
    await service.generate('u1', 'c1', request);
    await service.generate('u1', 'c2', request);
    expect(summarize).toHaveBeenCalledTimes(2);
  });
});
