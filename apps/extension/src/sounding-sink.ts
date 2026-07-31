import type { PlaybackSink } from '@chatofy/realtime-client';

/**
 * Any playback sink, plus a report of when it is actually sounding.
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
 * This reports the narrower fact: audio is queued or playing right now. That is
 * the only interval during which the loudspeaker can feed the microphone, which
 * is the only thing the gate exists to prevent.
 *
 * Ducking deliberately keeps using `isBusy` instead — see `duck-controller.ts`,
 * where releasing on a queue that runs dry between two clauses of one sentence
 * is the failure being avoided.
 */

/**
 * How often to look, while something is sounding.
 *
 * A sink whose audio plays somewhere else — in the meeting page — finishes on a
 * clock rather than on a callback, so there is nothing to be told by. Only
 * running while sounding keeps this off the idle path entirely.
 */
const POLL_MS = 100;

export class SoundingSink implements PlaybackSink {
  private sounding = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly delegate: PlaybackSink,
    private readonly onSoundingChanged: (sounding: boolean) => void,
  ) {}

  enqueue(turnKey: string, samples: Int16Array, sampleRate: number): void {
    this.delegate.enqueue(turnKey, samples, sampleRate);
    this.report();
  }

  isPlayingTurn(turnKey: string): boolean {
    return this.delegate.isPlayingTurn(turnKey);
  }

  get isPlaying(): boolean {
    return this.delegate.isPlaying;
  }

  stop(): void {
    this.delegate.stop();
    this.report();
  }

  stopTurn(turnKey: string): void {
    this.delegate.stopTurn(turnKey);
    this.report();
  }

  /** For a delegate that reports its own drains, so the flip is seen at once. */
  sync(): void {
    this.report();
  }

  /** Announce only transitions: the gate ramps, and a ramp per chunk is a buzz. */
  private report(): void {
    const sounding = this.delegate.isPlaying;
    if (sounding !== this.sounding) {
      this.sounding = sounding;
      this.onSoundingChanged(sounding);
    }
    if (sounding && !this.timer) {
      this.timer = setInterval(() => this.report(), POLL_MS);
    } else if (!sounding && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
