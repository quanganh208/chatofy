import {
  BadGatewayException,
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
import type { GenerateMinutesRequest } from '@chatofy/types';
import type { Env } from '../../config/env.schema';
import { MinutesService } from './minutes.service';
import { MemoryMinutesStore } from './stores/memory-minutes.store';

const draft: MeetingMinutesDraft = {
  summary: 'A short meeting.',
  keyPoints: ['point'],
  decisions: ['decided'],
  actionItems: [
    { description: 'do the thing', owner: 'Speaker 1', dueDate: null },
  ],
  model: 'gemini-3.5-flash',
};

const request: GenerateMinutesRequest = {
  turns: [{ speakerLabel: 'Speaker 1', text: 'hello' }],
};

/** A service wired to a fake summarizer, a real registry, and a real store. */
function makeService(summarize: SummarizationProvider['summarize']) {
  const store = new MemoryMinutesStore();
  const registry = new ProviderRegistry();
  registry.register('summarization', {
    name: 'gemini',
    create: () => ({ name: 'gemini', summarize }),
  });
  const config = { get: () => 'test-key' } as unknown as ConfigService<
    Env,
    true
  >;
  return { service: new MinutesService(config, registry, store), store };
}

describe('MinutesService', () => {
  it('maps a provider draft to a ready artifact with minted ids and a timestamp', async () => {
    const { service, store } = makeService(jest.fn().mockResolvedValue(draft));

    const minutes = await service.generate('u1', 's1', request);

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
    await expect(store.get('u1', 's1')).resolves.toEqual(minutes);
  });

  it('persists a failed record and rethrows 503 when the pool is unavailable', async () => {
    const { service, store } = makeService(
      jest
        .fn()
        .mockRejectedValue(new ProviderConnectionError('all cooling down')),
    );

    await expect(service.generate('u1', 's1', request)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(store.get('u1', 's1')).resolves.toMatchObject({
      status: 'failed',
    });
  });

  it('rethrows 502 when the model returns an unusable response', async () => {
    const { service } = makeService(
      jest
        .fn()
        .mockRejectedValue(new ProviderResponseError('non-JSON minutes')),
    );

    await expect(service.generate('u1', 's1', request)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('scopes reads to the owner — another user cannot read the minutes', async () => {
    const { service } = makeService(jest.fn().mockResolvedValue(draft));
    await service.generate('u1', 's1', request);

    await expect(service.get('u2', 's1')).resolves.toBeNull();
    await expect(service.get('u1', 's1')).resolves.toMatchObject({
      status: 'ready',
    });
  });

  it('returns null for a session with no generated minutes', async () => {
    const { service } = makeService(jest.fn().mockResolvedValue(draft));
    await expect(service.get('u1', 'never-generated')).resolves.toBeNull();
  });

  it('resolves the summarizer only once and keeps it warm', async () => {
    const summarize = jest.fn().mockResolvedValue(draft);
    const { service } = makeService(summarize);
    await service.generate('u1', 's1', request);
    await service.generate('u1', 's2', request);
    expect(summarize).toHaveBeenCalledTimes(2);
  });
});
