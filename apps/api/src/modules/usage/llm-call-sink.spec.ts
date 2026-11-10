import { Logger } from '@nestjs/common';
import {
  OpenAiCompatibleSummarizationProvider,
  type LlmCallEvent,
} from '@chatofy/ai-providers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../prisma/prisma.service';
import { recordLlmCall } from '../translate/providers/llm-call-log';
import { llmCallScope } from './llm-call-scope';
import {
  LLM_CALL_BUFFER_CAP,
  LLM_CALL_FLUSH_BATCH,
  LLM_CALL_FLUSH_INTERVAL_MS,
  LlmCallSink,
  currentLlmCallSink,
  setLlmCallSink,
} from './llm-call-sink';

type Row = { sessionId: string | null; userId: string | null; kind: string };

function fakePrisma(createMany = vi.fn(async () => ({ count: 0 }))) {
  return {
    prisma: { llmCallRecord: { createMany } } as unknown as PrismaService,
    createMany,
    rows: () =>
      createMany.mock.calls.flatMap(
        (call) => (call as unknown as [{ data: Row[] }])[0].data,
      ),
  };
}

const EVENT: LlmCallEvent = {
  kind: 'translate',
  purpose: 'final',
  host: 'commandcode',
  model: 'm',
  ms: 12,
  ok: true,
  inputTokens: 10,
  outputTokens: 2,
  promptHash: 'abcdef01',
};

/** A real provider whose host answers after `delayMs`, reporting through `recordLlmCall`. */
function slowProvider() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const { messages } = JSON.parse(init.body as string) as {
        messages: { content: string }[];
      };
      const delayMs = messages[1]!.content.includes('slow') ? 30 : 5;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"title":"T"}' } }],
          usage: { prompt_tokens: 7, completion_tokens: 3 },
        }),
        { status: 200 },
      );
    }),
  );
  return new OpenAiCompatibleSummarizationProvider({
    apiKey: 'k',
    baseUrl: 'https://host.example/v1',
    model: 'm',
    onCall: recordLlmCall,
  });
}

let log: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  setLlmCallSink(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('recordLlmCall attribution', () => {
  it('attributes each event to the scope it ran in, across interleaved awaits', async () => {
    const db = fakePrisma();
    const sink = new LlmCallSink(db.prisma);
    sink.onModuleInit();
    const provider = slowProvider();

    // The slow chain starts first and finishes last, so its event is emitted
    // while the fast chain's scope was the most recently entered one.
    const turn = (sessionId: string, speed: string) =>
      llmCallScope.run({ userId: `u-${sessionId}`, sessionId }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        await provider.title({ transcript: `An: ${speed}`, language: 'en' });
        await provider.title({ transcript: `An: ${speed}`, language: 'en' });
      });
    await Promise.all([turn('s-slow', 'slow'), turn('s-fast', 'fast')]);
    await sink.onModuleDestroy();

    const rows = db.rows();
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.userId).toBe(`u-${row.sessionId}`);
      expect(row.kind).toBe('title');
    }
    expect(rows.filter((r) => r.sessionId === 's-slow')).toHaveLength(2);
    expect(rows.filter((r) => r.sessionId === 's-fast')).toHaveLength(2);
  });

  it('keeps a call made outside any scope, with no user or session', async () => {
    const db = fakePrisma();
    const sink = new LlmCallSink(db.prisma);
    sink.onModuleInit();
    recordLlmCall(EVENT);
    await sink.flush();
    expect(db.rows()).toEqual([
      expect.objectContaining({
        userId: null,
        sessionId: null,
        kind: 'translate',
        purpose: 'final',
        inputTokens: 10,
        outputTokens: 2,
        cachedInputTokens: null,
        promptHash: 'abcdef01',
      }),
    ]);
    await sink.onModuleDestroy();
  });

  it('never rejects the provider call when the sink throws, and still logs the line', async () => {
    const sink = new LlmCallSink(fakePrisma().prisma);
    vi.spyOn(sink, 'record').mockImplementation(() => {
      throw new Error('sink down');
    });
    setLlmCallSink(sink);
    const provider = slowProvider();

    await expect(
      llmCallScope.run({ userId: 'u', sessionId: 's' }, () =>
        provider.title({ transcript: 'An: fast', language: 'en' }),
      ),
    ).resolves.toBe('T');
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^llm kind=title purpose=- host=openai-compatible /,
      ),
    );
  });

  it('only logs when no sink is set', () => {
    expect(currentLlmCallSink()).toBeNull();
    expect(() => recordLlmCall(EVENT)).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe('LlmCallSink buffering', () => {
  it('waits for the timer below a batch and writes at once when a batch fills', async () => {
    vi.useFakeTimers();
    const db = fakePrisma();
    const sink = new LlmCallSink(db.prisma);
    sink.onModuleInit();

    sink.record(EVENT, undefined);
    await vi.advanceTimersByTimeAsync(LLM_CALL_FLUSH_INTERVAL_MS - 1);
    expect(db.createMany).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(db.rows()).toHaveLength(1);

    for (let i = 0; i < LLM_CALL_FLUSH_BATCH; i += 1) {
      sink.record(EVENT, undefined);
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(db.rows()).toHaveLength(LLM_CALL_FLUSH_BATCH + 1);
    // Never more than one batch per write.
    for (const call of db.createMany.mock.calls) {
      const { data } = (call as unknown as [{ data: Row[] }])[0];
      expect(data.length).toBeLessThanOrEqual(LLM_CALL_FLUSH_BATCH);
    }
    await sink.onModuleDestroy();
  });

  it('drops the oldest rows past the cap and says how many', async () => {
    // A write that never settles holds the first batch in flight, which is a
    // database too slow to keep up.
    let release: () => void = () => undefined;
    const stalled = vi.fn(
      () =>
        new Promise<{ count: number }>((resolve) => {
          release = () => resolve({ count: 0 });
        }),
    );
    const db = fakePrisma(stalled);
    const sink = new LlmCallSink(db.prisma);

    const total = LLM_CALL_BUFFER_CAP + LLM_CALL_FLUSH_BATCH + 50;
    for (let i = 0; i < total; i += 1) {
      sink.record({ ...EVENT, ms: i }, undefined);
    }
    // The first batch left the buffer before the stall; the cap applies to
    // what was still waiting behind it.
    release();
    stalled.mockImplementation(async () => ({ count: 0 }));
    await sink.flush();
    await sink.flush();

    const written = db.rows() as unknown as { ms: number }[];
    expect(written).toHaveLength(LLM_CALL_FLUSH_BATCH + LLM_CALL_BUFFER_CAP);
    expect(written.at(-1)!.ms).toBe(total - 1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('dropped 50 oldest row(s)'),
    );
  });

  it('logs a failed write and never rejects', async () => {
    const db = fakePrisma(
      vi.fn(async () => {
        throw new Error('connection refused');
      }),
    );
    const sink = new LlmCallSink(db.prisma);
    sink.record(EVENT, undefined);
    await expect(sink.flush()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('failed to write 1 llm call row(s)'),
    );
  });

  it('flushes on shutdown and stops being the sink', async () => {
    const db = fakePrisma();
    const sink = new LlmCallSink(db.prisma);
    sink.onModuleInit();
    expect(currentLlmCallSink()).toBe(sink);
    sink.record(EVENT, { userId: 'u', sessionId: 's' });
    await sink.onModuleDestroy();
    expect(db.rows()).toEqual([
      expect.objectContaining({ userId: 'u', sessionId: 's' }),
    ]);
    expect(currentLlmCallSink()).toBeNull();
  });
});
