import { PcmPlaybackQueue, type PlaybackSink } from '@chatofy/realtime-client';

/**
 * The ordinary playback queue, plus a report of when it is actually sounding.
 *
 * Exists because the signal the session already offers — `onPlaybackBusy`, which
 * is `OrderedPlayback.isBusy` — answers a different question than the one the
 * microphone gate has to ask. `isBusy` is true from the moment a turn OPENS,
 * which is when the other person starts talking, and stays true until every turn
 * has both closed server-side and drained. In a meeting where someone talks for
 * forty-five seconds there is always a turn open, so a gate keyed on it would
 * hold the user's microphone shut for the whole stretch and the outbound
 * direction would never get a turn of its own. It would pass every test in a
 * quiet room.
 *
 * This reports the narrower fact: audio for some turn is queued or playing right
 * now. That is the only interval during which the loudspeaker can feed the
 * microphone, which is the only thing the gate exists to prevent.
 *
 * Ducking deliberately keeps using `isBusy` instead — see `duck-controller.ts`,
 * where releasing on a queue that runs dry between two clauses of one sentence
 * is the failure being avoided.
 */
export class SoundingSink implements PlaybackSink {
  private readonly queue: PcmPlaybackQueue;
  private sounding = false;

  constructor(
    context: AudioContext,
    onTurnDrained: (turnKey: string) => void,
    private readonly onSoundingChanged: (sounding: boolean) => void,
  ) {
    this.queue = new PcmPlaybackQueue(context, (turnKey) => {
      // The queue removes the turn before announcing it, so by the time the
      // report below runs, `isPlaying` already reflects the drain.
      onTurnDrained(turnKey);
      this.report();
    });
  }

  enqueue(turnKey: string, samples: Int16Array, sampleRate: number): void {
    this.queue.enqueue(turnKey, samples, sampleRate);
    this.report();
  }

  isPlayingTurn(turnKey: string): boolean {
    return this.queue.isPlayingTurn(turnKey);
  }

  get isPlaying(): boolean {
    return this.queue.isPlaying;
  }

  stop(): void {
    this.queue.stop();
    this.report();
  }

  stopTurn(turnKey: string): void {
    this.queue.stopTurn(turnKey);
    this.report();
  }

  /** Announce only transitions: the gate ramps, and a ramp per chunk is a buzz. */
  private report(): void {
    const sounding = this.queue.isPlaying;
    if (sounding === this.sounding) return;
    this.sounding = sounding;
    this.onSoundingChanged(sounding);
  }
}
