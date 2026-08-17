import type { Logger } from '@nestjs/common';
import type { LanguageCode } from '@chatofy/types';
import { matchClauseEnding } from '../audio/clause-seam';
import {
  StablePrefixCommitter,
  type TranscriptRead,
} from '../audio/stable-prefix-commit';
import type { PipelineTranslatorService } from '../services/pipeline-translator.service';
import type { EventChannel } from './event-channel';
import { pushSynthesizedWav } from './outbound-audio-framer';
import { FINAL_MODELS } from './translation-model-policy';
import type { TurnSession } from './turn-session';

/** True while the turn this work started on is still the socket's turn. */
type StillCurrent = () => boolean;

/**
 * What kind of read this is, from whoever produced it.
 *
 * `coversTurnStart` is asked for rather than inferred because only the producer
 * knows: a causal read is always anchored at the turn's first word, while a
 * re-read is anchored only until the turn outgrows the scheduler's window.
 */
interface ReadShape {
  coversTurnStart?: boolean;
  endsAtSilence?: boolean;
}

/**
 * Which language each direction reads and speaks.
 *
 * Local rather than imported from the pipeline's `directionLanguages` because
 * this file needs the pair for two different purposes — comparing source text
 * and synthesizing target speech — and a shared helper that returned only one
 * of them would have to be called twice with different arguments.
 */
const LANGUAGES: Record<
  string,
  { source: LanguageCode; target: LanguageCode }
> = {
  vi_to_en: { source: 'vi', target: 'en' },
  en_to_vi: { source: 'en', target: 'vi' },
};

/**
 * Speaks each settled clause while the speaker is still talking.
 *
 * Shaped after {@link LivePreview} on purpose — driven by arriving audio rather
 * than a timer, silent on failure, re-checking `stillCurrent()` after every
 * await — because a turn that ends or a client that disappears must leave
 * nothing behind, and a timer would keep working on a dead session.
 *
 * It differs from `LivePreview` in the one way that decides how careful this
 * file has to be: `LivePreview` is allowed to be wrong, because it only writes
 * to a screen and the next read replaces it. Everything here is played as audio
 * the moment it is produced. There is no correcting it afterwards, so this class
 * takes no shortcut past {@link StablePrefixCommitter} — the committer decides
 * what may be said, and this class only carries it out.
 */
export class StreamingCommitDriver {
  constructor(
    private readonly pipeline: PipelineTranslatorService,
    private readonly logger: Logger,
  ) {}

  /**
   * Offer one freshly decoded partial transcript to the commit policy.
   *
   * Cheap and synchronous up to the point where a clause is actually released;
   * most calls decide there is nothing safe to say yet and return having spent
   * nothing.
   */
  onPartial(
    session: TurnSession,
    channel: EventChannel,
    stillCurrent: StillCurrent,
    transcript: string,
    options: ReadShape = {},
  ): void {
    if (!session.streaming) return;

    const clause = this.committerFor(session).observe(
      this.readOf(session, transcript, options),
    );
    if (!clause) return;

    void this.speak(session, channel, stillCurrent, clause);
  }

  /**
   * Release whatever the turn has left, at the moment it ends.
   *
   * The turn is over, so there is no later read to contradict anything and no
   * boundary left to wait for. Returns the text released, so the caller can tell
   * how much of the turn is already spoken for.
   */
  finalClause(
    session: TurnSession,
    transcript: string,
    options: ReadShape = {},
  ): string {
    if (!session.streaming) return '';
    return this.committerFor(session).finalize(
      this.readOf(session, transcript, { ...options, endsAtSilence: true }),
    );
  }

  /** Clauses this turn has spoken, for the caller's own bookkeeping. */
  stats(session: TurnSession) {
    return this.committerFor(session).getStats();
  }

  private readOf(
    session: TurnSession,
    transcript: string,
    options: ReadShape,
  ): TranscriptRead {
    return {
      text: transcript,
      coversTurnStart:
        options.coversTurnStart ?? this.windowCoversStart(session),
      endsAtSilence: options.endsAtSilence,
    };
  }

  /**
   * Whether a RE-READ began at the turn's first word.
   *
   * Only ever asked about the re-read path, because it is the only one the
   * question applies to: the partial scheduler caps its window at the newest few
   * seconds, so on a long turn that read does not start where the turn does, and
   * lining the two up as if it did invents disagreements that never happened.
   *
   * A causal read is anchored by construction — it is the whole turn, decoded
   * once, in order — and must say so rather than come through here. It did come
   * through here once, and the result was that every Vietnamese turn stopped
   * committing the moment it passed the window: the read was declared windowed,
   * the aligner looked for an overlap that a full-turn read cannot have, and
   * returned nothing for the rest of the turn. That is indistinguishable from
   * the transcript freezing mid-sentence, which is what it looked like.
   */
  private windowCoversStart(session: TurnSession): boolean {
    const audio = session.buffered;
    return (
      audio === null ||
      !session.partials.isWindowedAt(audio.byteLength, audio.bytesPerSecond)
    );
  }

  /** One committer per turn, created on first use and kept on the session. */
  private committerFor(session: TurnSession): StablePrefixCommitter {
    return session.committer(
      () =>
        new StablePrefixCommitter({
          language: LANGUAGES[session.direction]?.source ?? 'vi',
        }),
    );
  }

  /**
   * Translate one clause as a continuation, speak it, and say what was said.
   *
   * Order matters and is not incidental. The clause is recorded as spoken
   * BEFORE the audio is pushed, because the record is what the next clause's
   * prompt is told it may not contradict — and the next partial can arrive while
   * this push is still running. Recording afterwards would let two clauses be
   * translated against the same "already spoken" text and say the same thing
   * twice.
   */
  private async speak(
    session: TurnSession,
    channel: EventChannel,
    stillCurrent: StillCurrent,
    clause: string,
  ): Promise<void> {
    const languages = LANGUAGES[session.direction];
    if (!languages) return;

    const spokenSoFar = session.spoken;
    const seq = session.spokenCount;

    try {
      const translated = await this.pipeline.translate({
        text: clause,
        direction: session.direction,
        // Deliberately the SAME ladder the turn's own ending uses. A clause that
        // is about to be spoken is not a guess that can be dropped cheaply; if
        // it cannot be translated the listener hears a hole, so it deserves the
        // fallback the final translation gets. `gemma-4-31b-it` is absent from
        // that ladder and must stay absent here: measured 0/6 on continuation,
        // and it returns its own reasoning alongside the translation — which on
        // this path is read aloud into the meeting.
        models: FINAL_MODELS,
        context: spokenSoFar,
      });
      if (!stillCurrent()) return;
      // The model finishes an isolated clause the way it finishes a sentence,
      // with a period. Synthesis reads intonation from punctuation, so left
      // alone that closes the phrase and drops the pitch in the middle of what
      // the speaker said in one breath. The source clause is the only evidence
      // of whether they actually stopped.
      const text = matchClauseEnding(translated, clause);
      if (!text) return;

      session.recordSpokenClause(text);

      const speech = await this.pipeline.synthesize({
        text,
        language: languages.target,
        voiceGender: session.voiceGender,
      });
      if (!stillCurrent()) return;

      const pushed = pushSynthesizedWav(
        channel,
        session,
        Buffer.from(speech.bytes),
      );
      if (!pushed.ok) {
        this.logger.debug(`commit audio not framed: ${pushed.detail}`);
        return;
      }

      session.recordClauseAudio();

      // Emitted after the audio, not before. The text is a caption for sound the
      // listener is already hearing; leading with it would show a clause that
      // has not been spoken yet, which is the one ordering this feature promises
      // never to produce.
      channel.emit({
        type: 'server.translation.commit',
        sessionId: session.sessionId,
        text,
        direction: session.direction,
        seq,
      });
    } catch (err: unknown) {
      // Swallowed like every other mid-turn courtesy: `end()` still answers the
      // turn, and an error thrown at someone mid-sentence helps nobody. Logged
      // rather than dropped, because a turn that quietly stops speaking is
      // exactly the failure that would otherwise look like the feature working.
      this.logger.debug(
        `commit clause skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
