import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRemoteAudioActivity, type RemoteAudioActivityDeps } from './remote-audio-activity';

/** A fake analyser whose waveform is a constant at `level`, so its RMS is `level`. */
function fakeAnalyser() {
  const analyser = {
    fftSize: 0,
    level: 0,
    disconnect: vi.fn(),
    getFloatTimeDomainData(target: Float32Array) {
      target.fill(analyser.level);
    },
  };
  return analyser;
}

let analysers: ReturnType<typeof fakeAnalyser>[];
let context: {
  state: AudioContextState;
  onstatechange: (() => void) | null;
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  createAnalyser: () => ReturnType<typeof fakeAnalyser>;
  createMediaStreamSource: () => { connect: () => void; disconnect: () => void };
};
let clock: number;
let deps: RemoteAudioActivityDeps;
const track = {} as MediaStreamTrack;

beforeEach(() => {
  analysers = [];
  clock = 0;
  context = {
    state: 'suspended',
    onstatechange: null,
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createAnalyser: () => {
      const analyser = fakeAnalyser();
      analysers.push(analyser);
      return analyser;
    },
    createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
  };
  deps = { createContext: () => context as unknown as AudioContext, now: () => clock };
  vi.stubGlobal(
    'MediaStream',
    class {
      constructor(readonly tracks: MediaStreamTrack[]) {}
    },
  );
});

describe('createRemoteAudioActivity', () => {
  it('reports silence while every peer is quiet', () => {
    const activity = createRemoteAudioActivity(deps);
    activity.add('a', track);
    activity.add('b', track);
    expect(activity.isSounding()).toBe(false);
  });

  it('reports sound while one peer is talking', () => {
    const activity = createRemoteAudioActivity(deps);
    activity.add('a', track);
    activity.add('b', track);
    analysers[1]!.level = 0.1;
    expect(activity.isSounding()).toBe(true);
  });

  it('holds through a short gap after the peer goes quiet', () => {
    const activity = createRemoteAudioActivity(deps);
    activity.add('a', track);
    analysers[0]!.level = 0.1;
    activity.isSounding();
    analysers[0]!.level = 0;
    clock = 250;
    expect(activity.isSounding()).toBe(true);
  });

  it('releases once the hold has passed', () => {
    const activity = createRemoteAudioActivity(deps);
    activity.add('a', track);
    analysers[0]!.level = 0.1;
    activity.isSounding();
    analysers[0]!.level = 0;
    clock = 350;
    expect(activity.isSounding()).toBe(false);
  });

  it('stops listening to a peer that left', () => {
    const activity = createRemoteAudioActivity(deps);
    activity.add('a', track);
    analysers[0]!.level = 0.1;
    activity.remove('a');
    expect(analysers[0]!.disconnect).toHaveBeenCalled();
    expect(activity.isSounding()).toBe(false);
  });

  it('closes its audio context on dispose', () => {
    const activity = createRemoteAudioActivity(deps);
    activity.add('a', track);
    activity.dispose();
    expect(context.close).toHaveBeenCalled();
  });

  it('resumes the context, which may start suspended outside a user gesture', () => {
    const activity = createRemoteAudioActivity(deps);
    activity.add('a', track);
    activity.add('b', track);
    expect(context.resume).toHaveBeenCalledTimes(2);
  });

  it('reports a suspended context, which reads silence, and resumes it on request', async () => {
    const changes = vi.fn();
    const activity = createRemoteAudioActivity({ ...deps, onStateChange: changes });
    expect(activity.isSuspended()).toBe(false);
    activity.add('a', track);
    expect(activity.isSuspended()).toBe(true);
    await activity.resume();
    expect(context.resume).toHaveBeenCalledTimes(2);
    context.onstatechange?.();
    expect(changes).toHaveBeenCalled();
  });
});
