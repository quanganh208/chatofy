import type { Logger } from '@nestjs/common';
import type { LanguageCode, TranslationPolisher } from '@chatofy/ai-providers';
import { TranslationBudget } from '../audio/translation-budget';
import type { EventChannel } from './event-channel';
import type { StreamSocket } from './stream-socket';
import type { TranslationMap } from './turn-language-plan';

/**
 * Polishes per user per minute, one per target. A conversation measured on
 * prod runs ~7–11 turns a minute, so this covers a busy speaker translating
 * into two languages; past it a turn simply keeps its draft.
 */
const POLISH_RPM = 20;
/** For the whole process: four users' worth, as the block budget allows. */
const POLISH_GLOBAL_RPM = POLISH_RPM * 4;
/** The budget is per model; the polish has one, so one key stands for it. */
const POLISH_BUDGET_KEY = 'polish';

export interface TurnPolishInput {
  userId: string;
  sessionId: string;
  sourceText: string;
  source: LanguageCode;
  translations: TranslationMap;
}

/**
 * The second pass over a finished turn: each translation offered to a stronger
 * model once, and `server.translation.polished` sent if any came back changed.
 *
 * Fire-and-forget by construction. It starts after `server.transcript.final`
 * is out and never delays it, the audio, or the next turn; every way it can
 * fail — no polisher on this host, a spent budget, a refusal, a timeout, a
 * socket already gone — ends the same way, with the draft standing. So none of
 * them is an error the session hears about.
 *
 * Checks `isGone`, not whether the turn is still current: an edit landing after
 * the turn closed is exactly the expected case, and the line it replaces is
 * still on the reader's screen.
 */
export class TurnPolisher {
  private readonly budget = new TranslationBudget({
    perUserRpm: POLISH_RPM,
    globalRpm: POLISH_GLOBAL_RPM,
  });

  constructor(
    private readonly polisher: TranslationPolisher | null,
    private readonly logger: Pick<Logger, 'debug'>,
    private readonly isGone: (socket: StreamSocket) => boolean,
  ) {}

  polish(
    socket: StreamSocket,
    channel: EventChannel,
    input: TurnPolishInput,
  ): void {
    void this.run(socket, channel, input).catch((err: unknown) => {
      this.logger.debug(`translation polish failed: ${describe(err)}`);
    });
  }

  private async run(
    socket: StreamSocket,
    channel: EventChannel,
    input: TurnPolishInput,
  ): Promise<void> {
    const polisher = this.polisher;
    if (!polisher) return;

    const asked: Promise<[LanguageCode, string | null]>[] = [];
    for (const [target, draft] of Object.entries(input.translations) as [
      LanguageCode,
      string | undefined,
    ][]) {
      if (!draft?.trim()) continue;
      if (!this.budget.canSpend(input.userId, POLISH_BUDGET_KEY)) break;
      this.budget.spend(input.userId, POLISH_BUDGET_KEY);
      asked.push(
        polisher
          .polish({
            source: input.sourceText,
            draft,
            sourceLanguage: input.source,
            targetLanguage: target,
          })
          .then((text): [LanguageCode, string | null] => [target, text]),
      );
    }
    if (!asked.length) return;

    const changed: TranslationMap = {};
    for (const outcome of await Promise.allSettled(asked)) {
      if (outcome.status === 'rejected') {
        // The message only: the transcript and translations are personal data.
        this.logger.debug(
          `translation polish failed: ${describe(outcome.reason)}`,
        );
        continue;
      }
      const [target, text] = outcome.value;
      if (text) changed[target] = text;
    }
    if (!Object.keys(changed).length || this.isGone(socket)) return;

    channel.emit({
      type: 'server.translation.polished',
      sessionId: input.sessionId,
      translations: { ...input.translations, ...changed },
    });
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
