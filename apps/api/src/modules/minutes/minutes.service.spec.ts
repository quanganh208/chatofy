import {
  BadGatewayException,
  Logger,
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
import { MINUTES_LIMITS, type GenerateMinutesRequest } from '@chatofy/types';
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
function makeService(
  summarize: SummarizationProvider['summarize'],
  reduce: SummarizationProvider['reduce'] = jest.fn(),
) {
  const store = new MemoryMinutesStore();
  const registry = new ProviderRegistry();
  registry.register('summarization', {
    name: 'gemini',
    create: () => ({ name: 'gemini', summarize, reduce }),
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

  it('summarizes a transcript over the chunk budget in parts and reduces them', async () => {
    const summarize = jest
      .fn()
      .mockResolvedValue({ ...draft, summary: 'part' });
    const reduce = jest.fn().mockResolvedValue({ ...draft, summary: 'merged' });
    const { service, store } = makeService(summarize, reduce);

    // Enough turns to exceed one chunk budget, forcing map-reduce.
    const line = 'x'.repeat(MINUTES_LIMITS.MAX_TURN_CHARS);
    const turns = Array.from({ length: 21 }, () => ({
      speakerLabel: 'S',
      text: line,
    }));

    const minutes = await service.generate('u1', 's-long', { turns });

    const chunkCount = summarize.mock.calls.length;
    expect(chunkCount).toBeGreaterThanOrEqual(2);
    // Every chunk mapped, then a single reduce over exactly those partials.
    expect(reduce).toHaveBeenCalledTimes(1);
    expect((reduce.mock.calls[0]![0] as unknown[]).length).toBe(chunkCount);
    // The reduced draft is what gets stored, not any single part.
    expect(minutes.summary).toBe('merged');
    await expect(store.get('u1', 's-long')).resolves.toMatchObject({
      status: 'ready',
      summary: 'merged',
    });
  });

  it('reduce-fits invariant: the meeting ceiling caps partials at a count a flat reduce merges (plan decision #4)', () => {
    // A map-reduce meeting yields one partial per chunk, and the two ceilings
    // bound the chunk count. `draftFor` therefore does a single FLAT reduce and
    // omits the plan's hierarchical (tiered) reduce as unreachable. This test is
    // that decision's leash: if MAX_MEETING_CHARS is ever raised so that more
    // than ten compact partials could reach one reduce, this goes RED — a signal
    // to implement the tiered reduce BEFORE the ceiling change, not a number to
    // bump. Ten ~1-2KB partials serialize far under the 80k reduce budget; well
    // past ten they may not, and the reduce would silently truncate at
    // MAX_TOKENS.
    const maxPartials = Math.ceil(
      MINUTES_LIMITS.MAX_MEETING_CHARS / MINUTES_LIMITS.MINUTES_CHUNK_CHARS,
    );
    expect(maxPartials).toBeLessThanOrEqual(10);
  });

  it('logs a cost pre-flight before spending quota on a map-reduce pass', async () => {
    const summarize = jest
      .fn()
      .mockResolvedValue({ ...draft, summary: 'part' });
    const reduce = jest.fn().mockResolvedValue({ ...draft, summary: 'merged' });
    const { service } = makeService(summarize, reduce);
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    const line = 'x'.repeat(MINUTES_LIMITS.MAX_TURN_CHARS);
    const turns = Array.from({ length: 21 }, () => ({
      speakerLabel: 'S',
      text: line,
    }));
    await service.generate('u1', 's-long', { turns });

    const chunkCount = summarize.mock.calls.length;
    const preflight = logSpy.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes('map-reduce'));
    // The estimate names the chunk count and the N+1 metered-call total.
    expect(preflight).toContain(`${chunkCount} chunks`);
    expect(preflight).toContain(`${chunkCount + 1} metered calls`);
    logSpy.mockRestore();
  });

  it('does not log a map-reduce pre-flight for a single-pass meeting', async () => {
    const { service } = makeService(jest.fn().mockResolvedValue(draft));
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await service.generate('u1', 's1', request);

    const preflight = logSpy.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes('map-reduce'));
    expect(preflight).toBeUndefined();
    logSpy.mockRestore();
  });
});
