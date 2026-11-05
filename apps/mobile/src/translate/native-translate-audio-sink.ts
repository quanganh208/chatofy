/**
 * Where a translate conversation's spoken translation comes out: this phone's
 * speaker, through react-native-audio-api.
 *
 * The shared session hands turns to a `PlaybackSink` one at a time, already in
 * spoken order (`OrderedPlayback` sits above it), so this only schedules gaplessly
 * — which `PcmPlaybackQueue` from `@chatofy/realtime-client` does against the
 * standard Web Audio surface react-native-audio-api implements.
 *
 * One context per TTS sample rate, because a context is pinned to a rate at
 * creation and the speech engine may change it between languages. Only one turn
 * plays at a time, so the queues never overlap.
 */

import { AudioContext } from 'react-native-audio-api';
import { PcmPlaybackQueue, type PlaybackSink } from '@chatofy/realtime-client';

// react-native-audio-api's AudioContext implements the Web Audio surface the queue
// needs, but its TypeScript types are its own. Cast at the single seam here.
type WebAudioContext = ConstructorParameters<typeof PcmPlaybackQueue>[0];

interface RateOutput {
  ctx: AudioContext;
  queue: PcmPlaybackQueue;
}

export class NativeTranslateAudioSink implements PlaybackSink {
  private readonly outputs = new Map<number, RateOutput>();

  constructor(private readonly onTurnDrained: (turnKey: string) => void) {}

  enqueue(turnKey: string, samples: Int16Array, sampleRate: number): void {
    this.outputFor(sampleRate).queue.enqueue(turnKey, samples, sampleRate);
  }

  isPlayingTurn(turnKey: string): boolean {
    for (const { queue } of this.outputs.values()) {
      if (queue.isPlayingTurn(turnKey)) return true;
    }
    return false;
  }

  /**
   * Whether anything is sounding. Only a running context counts: a suspended one
   * (a phone call or Siri took the audio) never ends its queued sounds, and counting
   * them would hold the gate shut on the user's speech from then on.
   */
  get isPlaying(): boolean {
    for (const { ctx, queue } of this.outputs.values()) {
      if (ctx.state === 'running' && queue.isPlaying) return true;
    }
    return false;
  }

  stopTurn(turnKey: string): void {
    for (const { queue } of this.outputs.values()) queue.stopTurn(turnKey);
  }

  /** Stops everything and releases the audio contexts. */
  stop(): void {
    for (const { ctx, queue } of this.outputs.values()) {
      queue.stop();
      void ctx.close();
    }
    this.outputs.clear();
  }

  private outputFor(sampleRate: number): RateOutput {
    const existing = this.outputs.get(sampleRate);
    if (existing) return existing;
    // react-native-audio-api creates the context suspended; without an explicit
    // resume the player never starts.
    const ctx = new AudioContext({ sampleRate });
    void ctx.resume();
    const queue = new PcmPlaybackQueue(ctx as unknown as WebAudioContext, this.onTurnDrained);
    const output = { ctx, queue };
    this.outputs.set(sampleRate, output);
    return output;
  }
}
