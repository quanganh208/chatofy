import type { Logger } from '@nestjs/common';
import type { TranslationPolisher } from '@chatofy/ai-providers';
import type { LanguageCode, TranslationHints } from '@chatofy/types';
import { TranslationBudget } from '../audio/translation-budget';
import { EventChannel } from './event-channel';
import type { FinishedSegments, SegmentBlock } from './finished-segments';
import type { StreamSocket } from './stream-socket';
import { FINAL_MODELS } from './translation-model-policy';
import type { TranslationMap } from './turn-language-plan';
import type { ScriptRetry } from '../services/foreign-script-retry';

/**
 * Translates a run of a connection's finished segments again, as one text, and
 * answers with `server.block.translated`.
 *
 * The ceiling cuts continuous speech mid-clause and each piece was translated
 * before the next existed, so the pieces' joined translations break at every
 * cut. Replayed on two recorded sessions, one translation of the whole block
 * repaired the seams the live path could not: a clause that completes the
 * sentence already spoken ("…barriers | To carry out this attack") cannot be
 * folded back in live, because the prompt forbids re-translating earlier speech.
 *
 * **Every request is answered**, a refusal with an empty `translations`: an
 * unknown segment, a block mixing two plans, a full queue, a request superseded
 * by a grown copy of itself, an exhausted budget or a failed call all leave the
 * client with the joined pieces, and the client stops waiting for that block
 * before it closes the socket. The one exception is a socket that has already
 * gone, which has nobody to answer. The answer is the same for a foreign id and
 * an evicted one, so it says nothing about other sockets.
 *
 * Its own holder rather than more of `TranslationSessionService`: it touches
 * nothing of a turn — only the finished segments, the translator and the
 * socket — and keeping it apart is what lets its queueing be tested without a
 * whole session harness.
 */

/**
 * Block retranslations per user per minute. A forced cut lands about every 8 s
 * and each one asks once, so continuous speech spends ~7.5; this leaves room for
 * a regrouping without letting a connection replay requests at line rate.
 */
const BLOCK_RETRANSLATION_RPM = 12;

/**
 * Block retranslations per minute for the whole process: four users' worth.
 *
 * The per-user tier is fairness between speakers; this one is what guards the
 * key pool, which every connection draws from at once. Past it every user's
 * block requests are refused (answered empty) until the minute rolls over, and
 * the live translation is untouched — it has its own budget.
 */
const BLOCK_RETRANSLATION_GLOBAL_RPM = BLOCK_RETRANSLATION_RPM * 4;

/**
 * How many blocks may wait per connection behind the one being translated.
 *
 * Exactly what the per-user budget could still translate in a minute after the
 * running one, so the budget stays the limit a legitimate burst meets — a
 * regroup after attribution can re-ask many blocks in one render, and a block
 * refused here is not asked again. The cap only stops the queue, which is keyed
 * by a client-chosen id, from growing with how fast a client can send; past it
 * the request is answered empty at once.
 */
/** The budget key block polishes are counted under, apart from translations. */
const BLOCK_POLISH_BUDGET_KEY = 'block-polish';

export const MAX_WAITING_BLOCKS = BLOCK_RETRANSLATION_RPM - 1;

/** How a block's display is made: a restore beside the translation, then typesetting. */
export interface BlockDisplay {
  /** The block restored as one text, or undefined. Must not reject. */
  restore(block: SegmentBlock): Promise<string | undefined>;
  /** The display to send for a restore and the block's translations, or undefined. */
  typeset(
    block: SegmentBlock,
    restored: string | undefined,
    translations: TranslationMap,
  ): string | undefined;
}

const NO_DISPLAY: BlockDisplay = {
  restore: async () => undefined,
  typeset: () => undefined,
};

/** What a block translation needs from the translator. */
export interface BlockTranslator {
  translateAll(req: {
    text: string;
    source: LanguageCode;
    targets: readonly LanguageCode[];
    models?: string[];
    hints?: TranslationHints;
    scriptRetry?: ScriptRetry;
    /** Always `'block'` from here; logged on the call's `llm` line. */
    purpose?: 'block';
  }): Promise<TranslationMap>;
}

export class BlockRetranslator {
  /**
   * Per connection while a block retranslation runs: the newest request waiting
   * for each other block, by first segment.
   */
  private readonly queues = new WeakMap<StreamSocket, Map<string, string[]>>();
  /**
   * Block retranslations' own ceiling, apart from the live-translation one,
   * because a client names what to translate here and a connection must not be
   * able to turn that into unbounded model calls.
   */
  private readonly budget = new TranslationBudget({
    perUserRpm: BLOCK_RETRANSLATION_RPM,
    globalRpm: BLOCK_RETRANSLATION_GLOBAL_RPM,
  });

  /** When the spent budget was last reported at warn; see `warnBudgetSpent`. */
  private budgetWarnedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly finished: FinishedSegments,
    private readonly translator: BlockTranslator,
    /** The owning service's logger, so these lines stay where operators look. */
    private readonly logger: Logger,
    /** Whether the client on this socket has gone; nothing is answered then. */
    private readonly isGone: (socket: StreamSocket) => boolean,
    /** How a block's display is made; without one, blocks carry none. */
    private readonly display: BlockDisplay = NO_DISPLAY,
    /**
     * The second pass a turn's translation gets, given to its block as well.
     *
     * The client shows a block's translation in place of its pieces', polished
     * or not, so a block translated without one undid the polish on every
     * forced cut. Replayed over the judged prod corpus, polishing the block
     * with the speech before it took block rows with a serious error from
     * 26.3% to 10.5% (10 fixed, 1 broken; vi→en 37.5% → 12.5%).
     */
    private readonly polisher: TranslationPolisher | null = null,
  ) {}

  /**
   * Translate `segmentIds` as one text, or queue the request behind the one
   * already running on this socket.
   *
   * One runs per connection at a time. Behind it, one request waits PER BLOCK —
   * keyed by its first segment — so a block that grew supersedes its shorter
   * self without displacing a different block; the superseded request is
   * answered empty at once, because the client waits for every block it asked
   * for. Re-asking the identical block merges with the copy already waiting:
   * the client keys blocks by their ids, so the one answer serves both.
   *
   * A request is checked against this socket's segments BEFORE it is queued, so
   * the queue only ever holds blocks the socket really produced.
   */
  async retranslate(
    socket: StreamSocket,
    segmentIds: string[],
    userId?: string,
  ): Promise<void> {
    const waiting = this.queues.get(socket);
    if (waiting) {
      this.enqueue(socket, waiting, segmentIds);
      return;
    }
    const queue = new Map<string, string[]>();
    this.queues.set(socket, queue);
    try {
      let next: string[] | undefined = segmentIds;
      while (next && !this.isGone(socket)) {
        await this.translateBlock(socket, next, userId ?? 'anonymous');
        const [key, ids] = queue.entries().next().value ?? [];
        if (key !== undefined) queue.delete(key);
        next = ids;
      }
    } finally {
      this.queues.delete(socket);
    }
  }

  private enqueue(
    socket: StreamSocket,
    waiting: Map<string, string[]>,
    segmentIds: string[],
  ): void {
    if (!this.finished.block(socket, segmentIds)) {
      return this.refuse(socket, segmentIds, 'segments not all known here');
    }
    const key = segmentIds[0]!;
    const displaced = waiting.get(key);
    if (!displaced && waiting.size >= MAX_WAITING_BLOCKS) {
      return this.refuse(socket, segmentIds, 'too many blocks waiting');
    }
    waiting.set(key, segmentIds);
    if (displaced && blockKeyOf(displaced) !== blockKeyOf(segmentIds)) {
      this.refuse(socket, displaced, 'superseded by a grown block');
    }
  }

  private async translateBlock(
    socket: StreamSocket,
    segmentIds: string[],
    userId: string,
  ): Promise<void> {
    // Checked again here, not only when queued: a segment can age out of the
    // socket's window while its block waits.
    const block = this.finished.block(socket, segmentIds);
    if (!block) {
      return this.refuse(socket, segmentIds, 'segments not all known here');
    }
    const model = FINAL_MODELS[0] ?? '';
    if (!this.budget.canSpend(userId, model)) {
      this.warnBudgetSpent();
      return this.refuse(socket, segmentIds, 'budget spent');
    }
    this.budget.spend(userId, model);
    // Beside the translation, on the same budget: a restore is local and a few
    // hundred milliseconds, and the reader gets both in the one answer.
    const restoring = this.display.restore(block);
    try {
      const translations = await this.translator.translateAll({
        text: block.sourceText,
        source: block.recognition,
        targets: block.targets,
        models: FINAL_MODELS,
        purpose: 'block',
        hints: block.hints,
        // A block is a final translation: it gets the one retry a turn's final
        // gets when it leaks a foreign script, charged to this block budget.
        scriptRetry: {
          label: `block=${segmentIds[0] ?? ''}`,
          allow: () => {
            if (!this.budget.canSpend(userId, model)) return false;
            this.budget.spend(userId, model);
            return true;
          },
        },
      });
      // After the translation, because it spells the names the restorer
      // cannot ("OpenAI"); the restore itself ran beside it.
      const restored = await restoring;
      const display = this.display.typeset(block, restored, translations);
      this.answer(socket, segmentIds, translations, display);
      // The draft goes out first and the polish replaces it when it lands, as
      // a turn's does: the block's own job, joining the seam, must not wait
      // seconds on a second model.
      void this.polish(
        socket,
        segmentIds,
        block,
        translations,
        restored,
        userId,
      ).catch((err: unknown) => {
        this.logger.warn(
          `block polish failed (${segmentIds.length} segments): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    } catch (err) {
      // Warn, unlike the refusals: a failed call is bounded by the budget, and
      // it is the one outcome here that says something is wrong upstream.
      this.logger.warn(
        `block retranslation failed (${segmentIds.length} segments): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.answer(socket, segmentIds, {});
    }
  }

  /**
   * Polish each target of an answered block with the speech before it, and
   * answer again if anything changed.
   *
   * Charged to this class's budget under its own key, so it has its own
   * buckets: a block is asked for about as often as a turn, and sharing the
   * retranslations' bucket would refuse blocks once polishes filled it, while
   * the turns' polish budget would spend the turns' polishes first.
   *
   * The second answer carries a `display` typeset again from the polished
   * text, because the client replaces the whole entry for a block: an answer
   * without one would erase it, and the draft's would put back the names the
   * polish changed.
   *
   * Two limits, both shared with the turns' polish. A block answered while the
   * conversation drains is saved with its draft: the polish lands after the
   * socket is gone and is dropped. And the context is the speech recorded
   * before the block's first segment in finish order, which is speech order
   * except when a later turn finished first.
   */
  private async polish(
    socket: StreamSocket,
    segmentIds: string[],
    block: SegmentBlock,
    drafts: TranslationMap,
    restored: string | undefined,
    userId: string,
  ): Promise<void> {
    const polisher = this.polisher;
    if (!polisher) return;
    const context = this.finished.before(socket, segmentIds[0]!);
    const asked: Promise<[LanguageCode, string | null]>[] = [];
    for (const [target, draft] of Object.entries(drafts) as [
      LanguageCode,
      string | undefined,
    ][]) {
      if (!draft?.trim()) continue;
      if (!this.budget.canSpend(userId, BLOCK_POLISH_BUDGET_KEY)) break;
      this.budget.spend(userId, BLOCK_POLISH_BUDGET_KEY);
      asked.push(
        polisher
          .polish({
            source: block.sourceText,
            draft,
            sourceLanguage: block.recognition,
            targetLanguage: target,
            ...(context.length ? { context } : {}),
          })
          .then((text): [LanguageCode, string | null] => [target, text])
          .catch((err: unknown): [LanguageCode, null] => {
            this.logger.debug(
              `block polish failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            return [target, null];
          }),
      );
    }
    if (!asked.length) return;
    const polished: TranslationMap = { ...drafts };
    let changed = false;
    for (const [target, text] of await Promise.all(asked)) {
      if (text && text !== drafts[target]) {
        polished[target] = text;
        changed = true;
      }
    }
    if (!changed || this.isGone(socket)) return;
    this.answer(
      socket,
      segmentIds,
      polished,
      this.display.typeset(block, restored, polished),
    );
  }

  /**
   * Say at warn that the budget is spent, at most once a minute. Unlike the
   * other refusals this one can be the process tier, which refuses every user
   * at once, and an operator must be able to see that without debug logs.
   */
  private warnBudgetSpent(): void {
    const now = Date.now();
    if (now - this.budgetWarnedAt < 60_000) return;
    this.budgetWarnedAt = now;
    this.logger.warn(
      'block retranslation refused: budget spent (further refusals this minute at debug)',
    );
  }

  /**
   * Answer a request empty. Logged at debug: a client decides how often these
   * happen, so at warn they would be log lines at whatever rate it sends.
   */
  private refuse(
    socket: StreamSocket,
    segmentIds: string[],
    reason: string,
  ): void {
    this.logger.debug(
      `block retranslation refused (${segmentIds.length} segments): ${reason}`,
    );
    this.answer(socket, segmentIds, {});
  }

  private answer(
    socket: StreamSocket,
    segmentIds: string[],
    translations: TranslationMap,
    display?: string,
  ): void {
    new EventChannel(socket, this.logger).emit({
      type: 'server.block.translated',
      segmentIds,
      translations,
      ...(display === undefined ? {} : { display }),
    });
  }
}

/** How a client keys a block: all of its ids, in order. */
function blockKeyOf(segmentIds: readonly string[]): string {
  return segmentIds.join('\u0000');
}
