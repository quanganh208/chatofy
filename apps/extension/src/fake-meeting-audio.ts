import type { DirectionSessionDeps } from './direction-session';
import type { DirectionRunner, EchoRunner, MeetingCaptureDeps } from './meeting-capture';
import type { GatedMicrophone } from './outbound-mic';

/**
 * Stand-ins for the browser, so the sequencing in `meeting-capture.ts` can be
 * exercised without one.
 *
 * These are deliberately observant rather than empty: what has to be asserted is
 * not "did it call getUserMedia" but the ORDER and the CLEANUP — that the
 * meeting's passthrough is connected before anything waits on a human, that a
 * refused microphone leaves the other direction running, that a teardown which
 * re-enters itself closes the context exactly once. Every fake below records the
 * facts those assertions need.
 */

class FakeTrack {
  stopped = 0;
  private readonly listeners: Record<string, (() => void)[]> = {};

  stop(): void {
    this.stopped += 1;
  }

  addEventListener(type: string, listener: () => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  /** What Chrome does to a captured tab's track when that tab navigates away. */
  end(): void {
    for (const listener of this.listeners.ended ?? []) listener();
  }
}

class FakeStream {
  readonly tracks = [new FakeTrack()];
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks;
  }
  get stopped(): boolean {
    return this.tracks.every((track) => track.stopped > 0);
  }
}

class FakeGain {
  readonly targets: number[] = [];
  readonly gain = {
    value: 1,
    setTargetAtTime: (value: number) => {
      this.targets.push(value);
    },
    setValueAtTime: (value: number) => {
      this.targets.push(value);
    },
  };
  connections = 0;
  disconnected = 0;
  connect(): void {
    this.connections += 1;
  }
  disconnect(): void {
    this.disconnected += 1;
  }
}

class FakeAudioContext {
  readonly sampleRate = 48000;
  currentTime = 0;
  state: AudioContextState = 'running';
  readonly destination = {};
  closed = 0;
  readonly gains: FakeGain[] = [];
  resumed = 0;

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  resume(): Promise<void> {
    this.resumed += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed += 1;
    return Promise.resolve();
  }
}

class FakeMicrophone implements GatedMicrophone {
  readonly stream = new FakeStream() as unknown as MediaStream;
  readonly suppressions: boolean[] = [];
  stopped = 0;

  setSuppressed(suppressed: boolean): void {
    this.suppressions.push(suppressed);
  }

  stop(): void {
    this.stopped += 1;
  }

  /** What the gate is asking of the microphone right now. */
  get suppressed(): boolean {
    return this.suppressions[this.suppressions.length - 1] ?? false;
  }
}

class FakeEcho implements EchoRunner {
  started = 0;
  stopped = 0;
  echoEvents = 0;
  constructor(readonly isPlaying: () => boolean) {}
  start(): Promise<void> {
    this.started += 1;
    return Promise.resolve();
  }
  stop(): void {
    this.stopped += 1;
  }
}

/** A session that records what it was wired to, and can fail on demand. */
class FakeSession implements DirectionRunner {
  started = 0;
  stopped = 0;
  echoesNoted = 0;
  startError: Error | null = null;
  /**
   * What the most recent `start()` call was given.
   *
   * Recorded rather than discarded because a whole feature — the resolved AI
   * Context hints reaching this call, and reaching it as the SAME object for
   * both directions — is only observable from here: everything else about a
   * direction is exercised through `deps`, which is fixed at construction, not
   * at start.
   */
  startOptions: Parameters<DirectionRunner['start']>[0] | undefined;

  constructor(readonly deps: DirectionSessionDeps) {
    // The real session asks for its playback sink while starting. Leaving that
    // out of the fake would hide everything the caller does with the sink it
    // hands over — including dropping audio in flight when the meeting mutes.
    deps.createSink?.(() => {});
  }

  start(options: Parameters<DirectionRunner['start']>[0]): Promise<void> {
    this.started += 1;
    this.startOptions = options;
    return this.startError ? Promise.reject(this.startError) : Promise.resolve();
  }

  stop(): void {
    this.stopped += 1;
    // Real sessions announce their own teardown, including the one they perform
    // on a dropped socket. Leaving that out of the fake would hide every
    // re-entrancy bug this exists to catch.
    this.deps.onStopped();
  }

  noteEchoHeard(): void {
    this.echoesNoted += 1;
  }

  /** What a dropped socket looks like from outside: the session stops itself. */
  dropConnection(): void {
    this.deps.onError('Connection to the translator dropped');
    this.stop();
  }
}

export interface Harness {
  deps: MeetingCaptureDeps;
  context: FakeAudioContext;
  tabStream: FakeStream;
  /** Set before `begin` to make the microphone refuse. */
  microphoneError: { current: Error | null };
  microphones: FakeMicrophone[];
  sessions: Record<'inbound' | 'outbound', FakeSession | undefined>;
  echoes: FakeEcho[];
  statuses: import('./messages').CaptureStatus[];
  transcripts: import('./messages').TranscriptLine[][];
  /** Order of the interesting steps, which is what most of this proves. */
  events: string[];
}

export function harness(): Harness {
  const context = new FakeAudioContext();
  const tabStream = new FakeStream();
  const microphoneError = { current: null as Error | null };
  const microphones: FakeMicrophone[] = [];
  const echoes: FakeEcho[] = [];
  const sessions: Record<'inbound' | 'outbound', FakeSession | undefined> = {
    inbound: undefined,
    outbound: undefined,
  };
  const statuses: import('./messages').CaptureStatus[] = [];
  const transcripts: import('./messages').TranscriptLine[][] = [];
  const events: string[] = [];

  const deps: MeetingCaptureDeps = {
    createContext: () => context as unknown as AudioContext,
    openTab: (_context, streamId) => {
      events.push(`tab:${streamId}`);
      return Promise.resolve({
        stream: tabStream as unknown as MediaStream,
        node: { connect: () => {} } as unknown as MediaStreamAudioSourceNode,
      });
    },
    openMicrophone: () => {
      events.push('microphone');
      if (microphoneError.current) return Promise.reject(microphoneError.current);
      const microphone = new FakeMicrophone();
      microphones.push(microphone);
      return Promise.resolve(microphone);
    },
    createEcho: (echoDeps) => {
      const echo = new FakeEcho(echoDeps.isPlaying);
      echoes.push(echo);
      return echo;
    },
    createSession: (sessionDeps) => {
      events.push(`session:${sessionDeps.direction === 'vi_to_en' ? 'vi_to_en' : 'en_to_vi'}`);
      const session = new FakeSession(sessionDeps);
      // Identified by input rather than by a flag: the outbound direction is the
      // one listening to the microphone, and asserting on that is what proves the
      // two were not swapped.
      const isOutbound = microphones.some((mic) => mic.stream === sessionDeps.input);
      sessions[isOutbound ? 'outbound' : 'inbound'] = session;
      return session;
    },
    loadAccessToken: () => Promise.resolve('fake-access-token'),
    workletUrl: '/worklets/mic-capture-processor.js',
    onStatus: (status) => statuses.push(status),
    onTranscript: (lines) => transcripts.push(lines),
  };

  // The gain stage the meeting's audio passes through is created inside
  // `MeetingCapture`; recording the moment it is connected is how the ordering
  // assertion sees it.
  const createGain = context.createGain.bind(context);
  context.createGain = () => {
    const gain = createGain();
    const connect = gain.connect.bind(gain);
    gain.connect = () => {
      events.push('passthrough');
      connect();
    };
    return gain;
  };

  return {
    deps,
    context,
    tabStream,
    microphoneError,
    microphones,
    sessions,
    echoes,
    statuses,
    transcripts,
    events,
  };
}
