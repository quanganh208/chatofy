import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MIC_PROCESSING, type MicProcessing } from '@chatofy/types';
import {
  NativePcmRecorder,
  type NativeRecorderApi,
  type NativeRecorderHandle,
  type OnAudioReadyEvent,
} from './native-pcm-recorder.ts';

/** A recorder the test drives by hand. */
class FakeRecorder implements NativeRecorderHandle {
  callback: ((event: OnAudioReadyEvent) => void) | null = null;
  started = 0;
  stopped = 0;
  onAudioReady(_options: unknown, callback: (event: OnAudioReadyEvent) => void): void {
    this.callback = callback;
  }
  clearOnAudioReady(): void {
    this.callback = null;
  }
  start(): Promise<void> {
    this.started += 1;
    return Promise.resolve();
  }
  stop(): Promise<void> {
    this.stopped += 1;
    return Promise.resolve();
  }
  deliver(samples: number[], sampleRate = 48000): void {
    this.callback?.({
      buffer: { getChannelData: () => Float32Array.from(samples), sampleRate },
      numFrames: samples.length,
      when: 0,
    });
  }
}

function setup(permission = 'Granted', mic: () => MicProcessing = () => DEFAULT_MIC_PROCESSING) {
  const recorders: FakeRecorder[] = [];
  const calls = { configured: 0, deactivated: 0 };
  /** The processing each session configuration and each recorder was asked for, in order. */
  const sessionMics: MicProcessing[] = [];
  const recorderMics: MicProcessing[] = [];
  const api: NativeRecorderApi = {
    configureSession: (asked) => {
      calls.configured += 1;
      sessionMics.push(asked);
    },
    deactivateSession: () => {
      calls.deactivated += 1;
      return Promise.resolve();
    },
    requestPermission: () => Promise.resolve(permission),
    createRecorder: (asked) => {
      recorderMics.push(asked);
      const recorder = new FakeRecorder();
      recorders.push(recorder);
      return recorder;
    },
  };
  const heard: number[][] = [];
  const onBuffer = (samples: Float32Array) => heard.push([...samples]);
  return {
    capture: new NativePcmRecorder(api, mic),
    recorders,
    calls,
    sessionMics,
    recorderMics,
    heard,
    onBuffer,
  };
}

describe('NativePcmRecorder', () => {
  it('opens with the platform processing on by default', async () => {
    const h = setup();
    await h.capture.start(h.onBuffer);

    assert.deepEqual(h.recorderMics, [DEFAULT_MIC_PROCESSING]);
    assert.equal(h.recorderMics[0]!.echoCancellation, true);
    assert.deepEqual(h.sessionMics, h.recorderMics);
  });

  it('opens with processing off when that is the stored choice', async () => {
    const off = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    const h = setup('Granted', () => off);
    await h.capture.start(h.onBuffer);

    assert.equal(h.recorderMics[0]!.echoCancellation, false);
    assert.deepEqual(h.sessionMics, [off]);
  });

  it('reads the choice again at each start, never mid-session', async () => {
    let current: MicProcessing = DEFAULT_MIC_PROCESSING;
    const h = setup('Granted', () => current);
    await h.capture.start(h.onBuffer);
    current = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    await h.capture.stop();
    await h.capture.start(h.onBuffer);

    assert.deepEqual(
      h.recorderMics.map((mic) => mic.echoCancellation),
      [true, false],
    );
  });

  it('keeps the audio session active when a recorder stops mid-call', async () => {
    const h = setup();
    await h.capture.start(h.onBuffer);
    await h.capture.stop();
    // The translate leg rebuilds: the same call starts recording again.
    await h.capture.start(h.onBuffer);
    await h.capture.stop();

    assert.equal(h.calls.deactivated, 0);
    assert.deepEqual(
      h.recorders.map((r) => r.stopped),
      [1, 1],
    );
  });

  it('releases the audio session once the call is over', async () => {
    const h = setup();
    await h.capture.start(h.onBuffer);

    await h.capture.releaseSession();

    assert.equal(h.recorders[0]!.stopped, 1);
    assert.equal(h.calls.deactivated, 1);
  });

  it('drops every buffer while muted and delivers again on unmute', async () => {
    const h = setup();
    await h.capture.start(h.onBuffer);
    const recorder = h.recorders[0]!;

    recorder.deliver([0.1]);
    h.capture.setPaused(true);
    recorder.deliver([0.2]);
    h.capture.setPaused(false);
    recorder.deliver([0.3]);

    assert.deepEqual(
      h.heard.map((samples) => Number(samples[0]!.toFixed(1))),
      [0.1, 0.3],
    );
  });

  it('hears nothing from a stopped recorder', async () => {
    const h = setup();
    await h.capture.start(h.onBuffer);
    const recorder = h.recorders[0]!;
    const late = recorder.callback!;
    await h.capture.stop();

    late({
      buffer: { getChannelData: () => Float32Array.from([0.5]), sampleRate: 48000 },
      numFrames: 1,
      when: 0,
    });

    assert.deepEqual(h.heard, []);
  });

  it('stops a recorder whose start was still opening when the call left', async () => {
    const h = setup();
    const starting = h.capture.start(h.onBuffer);
    const stopping = h.capture.releaseSession();
    await Promise.all([starting, stopping]);

    assert.equal(h.recorders.length, 1);
    assert.equal(h.recorders[0]!.stopped, 1);
    assert.equal(h.calls.deactivated, 1);
  });

  it('opens one recorder for two overlapping starts', async () => {
    const h = setup();
    await Promise.all([h.capture.start(h.onBuffer), h.capture.start(h.onBuffer)]);
    await h.capture.stop();

    assert.equal(h.recorders.length, 1);
    assert.equal(h.recorders[0]!.stopped, 1);
  });

  it('opens a fresh recorder for a start asked for after a stop of one still opening', async () => {
    const h = setup();
    const first = h.capture.start(h.onBuffer);
    void h.capture.stop(); // the leg rebuilds without waiting
    const rebuilt: number[][] = [];
    await Promise.all([first, h.capture.start((samples) => rebuilt.push([...samples]))]);

    assert.equal(h.recorders.length, 2);
    assert.equal(h.recorders[0]!.stopped, 1);
    h.recorders[1]!.deliver([0.4]);
    assert.deepEqual(
      rebuilt.map((samples) => Number(samples[0]!.toFixed(1))),
      [0.4],
    );
  });

  it('refuses to start without microphone permission, opening no recorder', async () => {
    const h = setup('Denied');

    await assert.rejects(h.capture.start(h.onBuffer), /permission not granted \(Denied\)/);
    assert.equal(h.recorders.length, 0);
  });
});
