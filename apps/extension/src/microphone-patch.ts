/**
 * Hands the meeting client a microphone track we compose, instead of the device.
 *
 * This is what makes it possible to speak the user's translation to the other
 * participants at all. A `MediaStream` cannot cross from the extension's
 * offscreen document into the page, so the only place their outgoing audio can
 * be reached is inside the page itself — which means wrapping the page's own
 * `getUserMedia` and returning a track fed by a graph we own.
 *
 * PASSTHROUGH ONLY here. Nothing is injected yet; the destination node is
 * exposed for the phase that ships translated audio into it. The value of
 * landing this alone is that "the meeting still works" becomes a question with
 * an answer, separate from "the injected audio sounds right".
 *
 * The rule that governs every decision below: **never hand back silence**. A
 * track that is `live` and unmuted and carries no samples is worse than no
 * feature, because every indicator the user and the client have says the
 * microphone is working. Any failure returns the original stream untouched.
 */

/**
 * The part of `navigator.mediaDevices` this patch replaces.
 *
 * A property rather than a method signature, because that is what it is used as
 * here: read, wrapped, reassigned, and put back. Declaring it as a method would
 * also make every reference to it look like an unbound call to the linter.
 */
export interface MediaDevicesLike {
  getUserMedia: (constraints?: MediaStreamConstraints) => Promise<MediaStream>;
}

export interface MicrophonePatchDeps {
  createContext: () => AudioContext;
  onLog?: (message: string) => void;
}

interface Graph {
  destination: MediaStreamAudioDestinationNode;
  /** The edge from the device into our graph, so a replaced graph can be cut. */
  source: MediaStreamAudioSourceNode;
}

export class MicrophonePatch {
  private context: AudioContext | null = null;
  /**
   * The graph behind the most recently returned stream.
   *
   * Meeting clients call `getUserMedia` more than once — a device preview before
   * joining, the call itself, and again on every device change — and each call
   * gets its own graph. Injected audio has to go into the one the client is
   * actually transmitting, which is the last one it asked for. Feeding an older
   * graph is inaudible to everyone while every signal here still looks healthy.
   */
  private current: Graph | null = null;

  constructor(private readonly deps: MicrophonePatchDeps) {}

  /** Where translated audio will be mixed in. Null when nothing is composed. */
  get destination(): MediaStreamAudioDestinationNode | null {
    return this.current?.destination ?? null;
  }

  /**
   * Wrap `getUserMedia` on the given object. Returns the undo.
   *
   * Nothing in the page can reach the undo — there is no extension-to-page
   * command channel in this phase — so turning the feature off mid-meeting takes
   * effect on the next page load rather than immediately. The handle exists for
   * the phase that adds that channel, and for the tests below.
   */
  install(devices: MediaDevicesLike): () => void {
    // The reference is kept as it was found, and the bound copy is only for
    // calling. Restoring a bound copy would leave the page holding a different
    // function than the one it had — and if that one was another extension's
    // wrapper, a different function than the one it expects to unwrap.
    const original = devices.getUserMedia;
    const call = original.bind(devices);

    const patched = async (constraints?: MediaStreamConstraints) => {
      const stream = await call(constraints);
      // Video-only requests are none of this patch's business, and composing
      // them would keep an audio graph alive for a camera.
      if (!constraints?.audio) return stream;
      try {
        return await this.compose(stream);
      } catch (err) {
        // The device stream is already open and working. Whatever went wrong
        // here, handing it back unchanged costs the feature and nothing else.
        this.deps.onLog?.(`could not compose the microphone: ${String(err)}`);
        return stream;
      }
    };

    devices.getUserMedia = patched;

    return () => {
      // Only if ours is still the one installed. Something that wrapped us after
      // the fact is entitled to keep working, and blindly assigning would cut it
      // out of its own chain.
      if (devices.getUserMedia === patched) devices.getUserMedia = original;
    };
  }

  private async compose(original: MediaStream): Promise<MediaStream> {
    const devices = original.getAudioTracks();
    // One track is every real case. More than one would mean deciding which to
    // carry and leaving the rest capturing into nothing, so the honest answer is
    // to leave the whole stream alone.
    if (devices.length !== 1) return original;
    const device = devices[0]!;

    const context = await this.readyContext();
    // A suspended context never advances `currentTime`, so its destination node
    // emits silence forever while the track it produces reports itself live.
    if (!context) {
      this.deps.onLog?.('audio context would not start; leaving the microphone alone');
      return original;
    }

    const source = context.createMediaStreamSource(original);
    const destination = context.createMediaStreamDestination();
    // Defaults to stereo while the device is almost always mono, which would
    // make `getSettings()` describe a track we are not handing over and give the
    // encoder a channel of silence.
    const channelCount = device.getSettings().channelCount;
    if (channelCount) destination.channelCount = channelCount;
    source.connect(destination);

    const [outgoing] = destination.stream.getAudioTracks();
    if (!outgoing) return original;

    const graph: Graph = { destination, source };
    proxyTrack(outgoing, device, () => {
      // A stopped graph must not still be offered as somewhere to put audio.
      if (this.current === graph) this.current = null;
    });

    // The client asked for video in the same call often enough that dropping it
    // here would break the camera. Added to the destination's own stream rather
    // than built into a new one, so no `MediaStream` constructor is needed.
    for (const video of original.getVideoTracks()) destination.stream.addTrack(video);

    // The graph this one replaces is no longer transmitted by anyone; leaving it
    // connected leaves a source node feeding a destination nobody reads, for
    // every device change in the meeting.
    this.current?.source.disconnect();
    this.current = graph;
    return destination.stream;
  }

  /**
   * The context, started.
   *
   * Created on the first wrapped call rather than at load: a context built
   * before any user gesture starts suspended, and this code runs at
   * `document_start` where no gesture has happened. By the time a meeting client
   * asks for a microphone, one has.
   */
  private async readyContext(): Promise<AudioContext | null> {
    this.context ??= this.deps.createContext();
    const context = this.context;
    if (context.state === 'suspended') await context.resume().catch(() => undefined);
    if (context.state !== 'running') return null;

    // A context can be suspended again later — a background tab is enough. The
    // alternative to noticing is a microphone that goes quiet without a signal.
    context.onstatechange = () => {
      if (context.state === 'suspended') void context.resume().catch(() => undefined);
    };
    return context;
  }
}

/**
 * Make the composed track behave like the device track it replaces.
 *
 * A `MediaStreamAudioDestinationNode`'s track is a synthetic thing: stopping it
 * does not release the microphone, its metadata is empty, its state never
 * changes, and it never fires the lifetime events a client uses to notice that a
 * device went away. Every one of those gaps is silent — the call keeps running
 * and nobody is heard.
 *
 * The properties matter as much as the events, and for the same reason. A client
 * that hears `ended` and then reads `readyState` to confirm gets a track that
 * says it is fine.
 */
function proxyTrack(
  outgoing: MediaStreamTrack,
  device: MediaStreamTrack,
  onStopped: () => void,
): void {
  const stopOutgoing = outgoing.stop.bind(outgoing);
  let stopped = false;

  outgoing.stop = () => {
    stopped = true;
    stopOutgoing();
    // Without this the device stays open and Chrome's recording indicator stays
    // lit after the client believes it released the microphone.
    device.stop();
    onStopped();
  };

  // Delegated rather than reimplemented: a client that reads these is choosing a
  // device or drawing a settings panel, and the honest answer is the real one.
  outgoing.getSettings = () => device.getSettings();
  outgoing.getCapabilities = () => device.getCapabilities();
  outgoing.getConstraints = () => device.getConstraints();
  outgoing.applyConstraints = (constraints?: MediaTrackConstraints) =>
    device.applyConstraints(constraints);

  for (const property of ['label', 'id'] as const) {
    Object.defineProperty(outgoing, property, {
      get: () => device[property],
      configurable: true,
    });
  }

  // The two properties a client reads to decide whether the microphone is still
  // usable. A destination track answers `live` and `false` forever, so without
  // these the events below are contradicted by the object that fired them.
  Object.defineProperty(outgoing, 'readyState', {
    get: (): MediaStreamTrackState => (stopped || device.readyState === 'ended' ? 'ended' : 'live'),
    configurable: true,
  });
  Object.defineProperty(outgoing, 'muted', {
    get: () => device.muted,
    configurable: true,
  });

  // Clients clone tracks for local previews and for `replaceTrack`. An unproxied
  // clone is a bare destination track: stopping it never reaches the device, and
  // its metadata and lifetime are empty again.
  const cloneOutgoing = outgoing.clone.bind(outgoing);
  outgoing.clone = () => {
    const clone = cloneOutgoing();
    proxyTrack(clone, device.clone(), () => {});
    return clone;
  };

  // The events that tell a client the microphone is gone. A destination track
  // never fires them, so unplugging a headset mid-call leaves the client
  // convinced the user is still connected and the user talking into nothing.
  for (const type of ['ended', 'mute', 'unmute'] as const) {
    device.addEventListener(type, () => outgoing.dispatchEvent(new Event(type)));
  }
}
