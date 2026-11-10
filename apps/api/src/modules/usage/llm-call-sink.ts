import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { LlmCallEvent } from '@chatofy/ai-providers';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import type { LlmCallScope } from './llm-call-scope';

/** Rows are written at least this often while any are waiting. */
export const LLM_CALL_FLUSH_INTERVAL_MS = 5_000;
/** A batch this large is written at once instead of waiting for the timer. */
export const LLM_CALL_FLUSH_BATCH = 200;
/**
 * The most rows held while the database is slow or down. Prod runs about 2-5k
 * calls per conversation-hour, so this is minutes of backlog; past it the
 * oldest rows are dropped, and counted, rather than growing the heap.
 */
export const LLM_CALL_BUFFER_CAP = 2_000;

type LlmCallRow = Prisma.LlmCallRecordCreateManyInput;

/**
 * Persists every `LlmCallEvent` as an `LlmCallRecord` row, attributed to the
 * scope it was emitted in.
 *
 * Writes are buffered and batched so recording a call never adds latency to the
 * request it describes, and nothing here can fail one: `record` only pushes to
 * an array, and a failed write is logged and its batch dropped.
 *
 * The providers are built in a plain factory outside DI, so they cannot inject
 * this. They reach it through {@link currentLlmCallSink}, which this class sets
 * for its own lifetime; with no sink set, an event is only logged.
 */
@Injectable()
export class LlmCallSink implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LlmCallSink.name);
  private buffer: LlmCallRow[] = [];
  private dropped = 0;
  private flushing: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.flush();
    }, LLM_CALL_FLUSH_INTERVAL_MS);
    // A metrics timer must never be what keeps the process alive.
    this.timer.unref();
    setLlmCallSink(this);
  }

  async onModuleDestroy(): Promise<void> {
    if (currentSink === this) setLlmCallSink(null);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  /** Queue one event. Synchronous and allocation-only; never throws on its own. */
  record(event: LlmCallEvent, scope: LlmCallScope | undefined): void {
    this.buffer.push({
      userId: scope?.userId ?? null,
      sessionId: scope?.sessionId ?? null,
      kind: event.kind,
      purpose: event.purpose ?? null,
      host: event.host,
      model: event.model,
      ms: Math.round(event.ms),
      ok: event.ok,
      inputTokens: event.inputTokens ?? null,
      outputTokens: event.outputTokens ?? null,
      cachedInputTokens: event.cachedInputTokens ?? null,
      promptHash: event.promptHash,
    });
    if (this.buffer.length > LLM_CALL_BUFFER_CAP) {
      const over = this.buffer.length - LLM_CALL_BUFFER_CAP;
      this.buffer.splice(0, over);
      this.dropped += over;
    }
    if (this.buffer.length >= LLM_CALL_FLUSH_BATCH) void this.flush();
  }

  /**
   * Write everything buffered, one batch at a time. A flush already running is
   * joined rather than raced, so two writers never take the same rows. Resolves
   * once the buffer is empty or a write failed; never rejects.
   */
  flush(): Promise<void> {
    this.flushing ??= this.drain().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async drain(): Promise<void> {
    if (this.dropped > 0) {
      this.logger.warn(
        `llm call buffer full; dropped ${this.dropped} oldest row(s)`,
      );
      this.dropped = 0;
    }
    while (this.buffer.length > 0) {
      const batch = this.buffer.splice(0, LLM_CALL_FLUSH_BATCH);
      try {
        await this.prisma.llmCallRecord.createMany({ data: batch });
      } catch (err) {
        // Dropped, not re-queued: a database that rejects this batch would
        // reject it again, and the log line already holds every call.
        this.logger.warn(
          `failed to write ${batch.length} llm call row(s): ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
    }
  }
}

let currentSink: LlmCallSink | null = null;

/** Point every provider's `onCall` at a sink, or back at log-only with `null`. */
export function setLlmCallSink(sink: LlmCallSink | null): void {
  currentSink = sink;
}

/** The sink events are handed to, or `null` when only the log line is written. */
export function currentLlmCallSink(): LlmCallSink | null {
  return currentSink;
}
