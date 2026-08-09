import { describe, expect, it, vi } from 'vitest';
import { MicrophonePatch, type MediaDevicesLike } from './microphone-patch';

/**
 * What a meeting client is entitled to expect from a microphone track.
 *
 * Every test here stands for a way the call keeps running while nobody can hear
 * the user — the failure mode this patch is most able to cause and least able to
 * signal.
 */

class FakeTrack extends EventTarget {
  stopped = 0;
  readyState: MediaStreamTrackState = 'live';
  muted = false;
  /** The meeting client's own mute, assigned on the track it was handed. */
  enabled = true;
  clones = 0;
  constructor(
    readonly kind: 'audio' | 'video',
    readonly label = '',
    readonly id = '',
  ) {
    super();
  }
  stop(): void {
    this.stopped += 1;
  }
  clone(): FakeTrack {
    this.clones += 1;
    return new FakeTrack(this.kind, this.label, this.id);
  }
  getSettings(): MediaTrackSettings {
    return { deviceId: this.id, channelCount: 1 };
  }
  getCapabilities(): MediaTrackCapabilities {
    return {};
  }
  getConstraints(): MediaTrackConstraints {
    return {};
  }
  applyConstraints(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === 'video');
  }
  addTrack(track: FakeTrack): void {
    this.tracks.push(track);
  }
}

class FakeContext {
  state: AudioContextState = 'running';
  resumed = 0;
  onstatechange: (() => void) | null = null;
  /** Stands in for the destination node's synthetic track. */
  readonly outgoing = new FakeTrack('audio');
  readonly destinationStream = new FakeStream([this.outgoing]);
  readonly connections: unknown[] = [];
  disconnections = 0;

  // Arrow properties rather than methods: the tests replace them per case, and a
  // reassigned method loses its `this`.
  createMediaStreamSource = (stream: unknown) => ({
    connect: (node: unknown) => {
      this.connections.push([stream, node]);
    },
    disconnect: () => {
      this.disconnections += 1;
    },
  });

  createMediaStreamDestination = (): { stream: FakeStream; channelCount: number } => ({
    stream: this.destinationStream,
    channelCount: 2,
  });

  /** The stage the user's own voice is lowered through while translating. */
  createGain = () => ({
    connect: () => {},
    disconnect: () => {},
    gain: { value: 1, setTargetAtTime: () => {}, setValueAtTime: () => {} },
  });

  resume = (): Promise<void> => {
    this.resumed += 1;
    this.state = 'running';
    return Promise.resolve();
  };
}

interface Harness {
  patch: MicrophonePatch;
  devices: MediaDevicesLike;
  context: FakeContext;
  device: FakeTrack;
  original: FakeStream;
  logs: string[];
}

function harness(options: { state?: AudioContextState; video?: boolean } = {}): Harness {
  const context = new FakeContext();
  if (options.state) context.state = options.state;
  const device = new FakeTrack('audio', 'Headset (USB)', 'device-1');
  const tracks = [device];
  if (options.video) tracks.push(new FakeTrack('video'));
  const original = new FakeStream(tracks);
  const logs: string[] = [];

  const patch = new MicrophonePatch({
    createContext: () => context as unknown as AudioContext,
    onLog: (message) => logs.push(message),
  });

  const devices: MediaDevicesLike = {
    getUserMedia: () => Promise.resolve(original as unknown as MediaStream),
  };
  patch.install(devices);

  return { patch, devices, context, device, original, logs };
}

const audio = { audio: true };

describe('MicrophonePatch', () => {
  it('hands the client the composed track rather than the device one', async () => {
    const h = harness();

    const stream = (await h.devices.getUserMedia(audio)) as unknown as FakeStream;

    expect(stream.getAudioTracks()[0]).toBe(h.context.outgoing);
    expect(stream.getAudioTracks()[0]).not.toBe(h.device);
  });

  it('leaves a video-only request completely alone', async () => {
    // Composing one would keep an audio graph alive for a camera.
    const h = harness();

    const stream = await h.devices.getUserMedia({ video: true });

    expect(stream).toBe(h.original as unknown as MediaStream);
  });

  it('carries video tracks through to the client', async () => {
    const h = harness({ video: true });

    const stream = (await h.devices.getUserMedia({
      audio: true,
      video: true,
    })) as unknown as FakeStream;

    expect(stream.getVideoTracks()).toHaveLength(1);
  });

  describe('never handing back silence', () => {
    it('returns the device stream when the context will not start', async () => {
      // A suspended context never advances its clock, so its destination emits
      // silence while the track reports itself live: the client shows a working
      // microphone, and nobody hears anything.
      const h = harness({ state: 'suspended' });
      h.context.resume = () => {
        h.context.state = 'suspended';
        return Promise.resolve();
      };

      const stream = await h.devices.getUserMedia(audio);

      expect(stream).toBe(h.original as unknown as MediaStream);
      expect(h.logs.join(' ')).toContain('would not start');
    });

    it('returns the device stream when composing throws', async () => {
      const h = harness();
      h.context.createMediaStreamDestination = () => {
        throw new Error('no destination for you');
      };

      const stream = await h.devices.getUserMedia(audio);

      expect(stream).toBe(h.original as unknown as MediaStream);
    });

    it('resumes a context that was suspended when it was created', async () => {
      const h = harness({ state: 'suspended' });

      await h.devices.getUserMedia(audio);

      expect(h.context.resumed).toBe(1);
    });
  });

  describe('the composed track behaves like a device track', () => {
    it('releases the real microphone when the client stops it', async () => {
      // Stopping only the synthetic track leaves the device open with Chrome's
      // recording indicator lit, after the client believes it let go.
      const h = harness();
      const stream = (await h.devices.getUserMedia(audio)) as unknown as FakeStream;

      stream.getAudioTracks()[0]!.stop();

      expect(h.device.stopped).toBe(1);
    });

    it('reports the real device metadata', async () => {
      const h = harness();
      const stream = (await h.devices.getUserMedia(audio)) as unknown as FakeStream;
      const track = stream.getAudioTracks()[0]!;

      expect(track.label).toBe('Headset (USB)');
      expect(track.id).toBe('device-1');
      expect(track.getSettings()).toEqual({ deviceId: 'device-1', channelCount: 1 });
    });

    it('agrees with its own events about whether it is still live', async () => {
      // A client that hears `ended` and then reads `readyState` to confirm would
      // otherwise get a track insisting it is fine.
      const h = harness();
      const stream = (await h.devices.getUserMedia(audio)) as unknown as FakeStream;
      const track = stream.getAudioTracks()[0]!;
      expect(track.readyState).toBe('live');

      h.device.readyState = 'ended';

      expect(track.readyState).toBe('ended');
    });

    it('reports the device as muted when the device is muted', async () => {
      const h = harness();
      const stream = (await h.devices.getUserMedia(audio)) as unknown as FakeStream;
      const track = stream.getAudioTracks()[0]!;

      h.device.muted = true;

      expect(track.muted).toBe(true);
    });

    it('hands back a clone that still reaches the device', async () => {
      // Clients clone for previews and for `replaceTrack`. An unproxied clone
      // stops nothing, so the recording indicator stays lit after hangup.
      const h = harness();
      const stream = (await h.devices.getUserMedia(audio)) as unknown as FakeStream;

      const clone = stream.getAudioTracks()[0]!.clone();
      clone.stop();

      expect(h.device.clones).toBe(1);
      expect(clone.label).toBe('Headset (USB)');
    });

    it('matches the destination channel count to the device', async () => {
      // Stereo out of a mono microphone makes `getSettings()` describe a track
      // we are not handing over, and gives the encoder a channel of silence.
      const h = harness();
      let destination: { channelCount: number } | undefined;
      const create = h.context.createMediaStreamDestination;
      h.context.createMediaStreamDestination = () => {
        destination = create();
        return destination as unknown as ReturnType<typeof create>;
      };

      await h.devices.getUserMedia(audio);

      expect(destination!.channelCount).toBe(1);
    });

    it('passes on the events that say the microphone went away', async () => {
      // Unplug a headset mid-call: the device track ends, and a destination
      // track never would. Without this the client never re-acquires and the
      // user talks into a dead line for the rest of the meeting.
      const h = harness();
      const stream = (await h.devices.getUserMedia(audio)) as unknown as FakeStream;
      const track = stream.getAudioTracks()[0]!;
      const seen: string[] = [];
      for (const type of ['ended', 'mute', 'unmute']) {
        track.addEventListener(type, () => seen.push(type));
      }

      for (const type of ['ended', 'mute', 'unmute']) {
        h.device.dispatchEvent(new Event(type));
      }

      expect(seen).toEqual(['ended', 'mute', 'unmute']);
    });
  });

  describe('where injected audio would go', () => {
    it('is nowhere until a call has been composed', () => {
      const h = harness();

      expect(h.patch.injectionPoint).toBeNull();
    });

    it('is nowhere once the client has stopped the track', async () => {
      // Offering a dead graph would send the next phase's audio into a node
      // nobody transmits, and every signal here would still look healthy.
      const h = harness();
      const stream = (await h.devices.getUserMedia(audio)) as unknown as FakeStream;

      stream.getAudioTracks()[0]!.stop();

      expect(h.patch.injectionPoint).toBeNull();
    });

    it('covers every graph the client still holds, not only the newest', async () => {
      // A device change mid-call means a second `getUserMedia`, and the client
      // may go on transmitting either one. Ducking only the newest left the
      // user's own voice at full level under their translation on the track the
      // meeting actually carried.
      const h = harness();
      await h.devices.getUserMedia(audio);
      expect(h.patch.injectionPoint?.graphs).toHaveLength(1);

      const second = new FakeContext();
      h.context.createMediaStreamDestination = () => ({
        stream: second.destinationStream,
        channelCount: 2,
      });
      await h.devices.getUserMedia(audio);

      expect(h.patch.injectionPoint?.graphs).toHaveLength(2);
    });

    it('drops a graph from the set once the client stops it', async () => {
      const h = harness();
      const preview = (await h.devices.getUserMedia(audio)) as unknown as FakeStream;
      const previewTrack = preview.getAudioTracks()[0]!;

      const second = new FakeContext();
      h.context.createMediaStreamDestination = () => ({
        stream: second.destinationStream,
        channelCount: 2,
      });
      await h.devices.getUserMedia(audio);
      previewTrack.stop();

      expect(h.patch.injectionPoint?.graphs).toHaveLength(1);
    });

    it('leaves the microphone in a graph the client has not stopped', async () => {
      // The defect this replaces: a second `getUserMedia` cut the device out of
      // the first graph, on the assumption that a client transmits its newest
      // track. Meet does not — it keeps transmitting the one it joined with — so
      // the user's own voice stopped reaching the meeting the moment a settings
      // panel or a device change composed a newer graph, with every indicator
      // still reporting a working microphone.
      const h = harness();
      await h.devices.getUserMedia(audio);

      const second = new FakeContext();
      h.context.createMediaStreamDestination = () => ({
        stream: second.destinationStream,
        channelCount: 2,
      });
      await h.devices.getUserMedia(audio);

      expect(h.context.disconnections).toBe(0);
    });

    it('cuts a graph loose once the client stops the track it was given', async () => {
      // The other half: a graph the client HAS finished with must not be left
      // with a source node feeding a destination nobody reads, for the whole call.
      const h = harness();
      const stream = (await h.devices.getUserMedia(audio)) as unknown as FakeStream;

      stream.getAudioTracks()[0]!.stop();

      expect(h.context.disconnections).toBe(1);
    });
  });

  describe('whether the client is transmitting', () => {
    /**
     * The one privacy rule of this direction: a user who mutes in the meeting
     * client must stop being captured. The mute lands on the track the client is
     * transmitting, which is not necessarily the newest one composed.
     */
    it('is false while the client has muted the track it was handed', async () => {
      const h = harness();
      await h.devices.getUserMedia(audio);

      h.context.outgoing.enabled = false;

      expect(h.patch.injectionPoint?.transmitting).toBe(false);
    });

    it('is false when a mute lands on an earlier graph than the newest', async () => {
      // Read off the newest graph alone, this said "transmitting" while the user
      // sat muted — so their private speech was still captured, transcribed and
      // sent to be translated. The newest track is not the one they muted.
      const h = harness();
      await h.devices.getUserMedia(audio);
      const kept = h.context.outgoing;

      const second = new FakeContext();
      h.context.createMediaStreamDestination = () => ({
        stream: second.destinationStream,
        channelCount: 2,
      });
      await h.devices.getUserMedia(audio);

      kept.enabled = false;

      expect(h.patch.injectionPoint?.transmitting).toBe(false);
    });

    it('ignores a graph the client has stopped', async () => {
      // A preview the client opened, muted and closed cannot be allowed to gate
      // the feature shut for the rest of the call.
      const h = harness();
      const preview = (await h.devices.getUserMedia(audio)) as unknown as FakeStream;
      const previewTrack = preview.getAudioTracks()[0]!;

      const second = new FakeContext();
      h.context.createMediaStreamDestination = () => ({
        stream: second.destinationStream,
        channelCount: 2,
      });
      await h.devices.getUserMedia(audio);

      previewTrack.enabled = false;
      previewTrack.stop();

      expect(h.patch.injectionPoint?.transmitting).toBe(true);
    });
  });

  it('puts the page back exactly as it was found', () => {
    // Including another extension's wrapper, if one got there first.
    const originalFn = vi.fn(() => Promise.resolve(new FakeStream([]) as unknown as MediaStream));
    const devices: MediaDevicesLike = { getUserMedia: originalFn };
    const patch = new MicrophonePatch({
      createContext: () => new FakeContext() as unknown as AudioContext,
    });

    const uninstall = patch.install(devices);
    expect(devices.getUserMedia).not.toBe(originalFn);

    uninstall();
    expect(devices.getUserMedia).toBe(originalFn);
  });

  it('leaves a wrapper that arrived after it in place', () => {
    // Someone else's patch is entitled to keep working; assigning blindly on
    // uninstall would cut it out of its own chain.
    const h = harness();
    const patch = new MicrophonePatch({
      createContext: () => new FakeContext() as unknown as AudioContext,
    });
    const uninstall = patch.install(h.devices);
    const later = () => Promise.resolve(h.original as unknown as MediaStream);
    h.devices.getUserMedia = later;

    uninstall();

    expect(h.devices.getUserMedia).toBe(later);
  });
});
