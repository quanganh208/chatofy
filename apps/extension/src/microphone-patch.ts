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
  /** The user's own voice, lowered while their translation is speaking. */
  duck: GainNode;
  /** What the client is transmitting, so mute can be read off it. */
  outgoing: MediaStreamTrack;
}

/** One composed track, and the stage the user's own voice passes through on it. */
interface ComposedGraph {
  destination: MediaStreamAudioDestinationNode;
  /** The user's own voice, lowered while their translation is speaking. */
  duck: GainNode;
}

/** Where translated audio is mixed in, and what it has to duck to be heard. */
export interface InjectionPoint {
  context: AudioContext;
  /**
   * Where translated audio is written — a bus feeding EVERY composed track, not
   * the newest one's destination.
   *
   * Writing into the newest destination is what an earlier version did, on the
   * assumption that a client transmits the track from its most recent
   * `getUserMedia`. Nothing enforces that, and Meet does not honour it: a device
   * preview, a settings panel or a device change composes a newer graph while the
   * call keeps transmitting the track it was given at join time. Audio written to
   * the newest destination then reached nobody, and `transmitting` — read off
   * that same newest graph — stayed true, so the extension reported the user's
   * speech as reaching the meeting for the whole call while it was silent.
   *
   * A bus into every graph costs one gain node per track and removes the guess.
   */
  injection: AudioNode;
  /**
   * Every live composed graph, for the same reason the injection is a bus.
   *
   * Ducking one of them — the newest — is what this did, and it is the same
   * wrong guess in a quieter form: the translation reached the track the client
   * was transmitting because the bus fans out, while the voice under it was
   * lowered on a graph nobody could hear. Both voices then went out at full
   * level and the translation had to compete with the speaker it was
   * translating. Measured at 0.71 gain where 0.2 was intended.
   */
  graphs: ComposedGraph[];
  /**
   * False while the meeting client has muted ANY track it was handed.
   *
   * Not the newest track's `enabled`, for the same reason injected audio does
   * not go to the newest destination: the client may be transmitting a graph it
   * asked for earlier, and the mute the user pressed lands on THAT one. Reading
   * the newest leaves the user muted in the meeting and still being captured,
   * transcribed and translated — the one thing this direction promises not to do.
   *
   * So every live graph has to agree before this says yes. The cost of the
   * conservative direction is a stale muted graph gating the feature shut; the
   * cost of the other is translating speech the user muted to keep private, and
   * this whole channel is built on preferring the first.
   */
  get transmitting(): boolean;
}

export class MicrophonePatch {
  private context: AudioContext | null = null;
  /**
   * The graph behind the most recently returned stream.
   *
   * Meeting clients call `getUserMedia` more than once — a device preview before
   * joining, the call itself, and again on every device change — and each call
   * gets its own graph. This one is no longer where injected audio goes (the bus
   * below reaches all of them); it is only which graph's duck stage the page-world
   * controller attaches to, and something has to be picked. The newest is the
   * best guess available, and guessing wrong costs the ducking rather than the
   * audio.
   */
  private current: Graph | null = null;

  /**
   * The one node translated audio is written to, fanned out to every graph.
   *
   * Outlives any single graph on purpose: it is what makes the injection
   * independent of which `getUserMedia` call the client decided to keep.
   */
  private injection: GainNode | null = null;

  /**
   * Every graph composed so far that the client has not stopped.
   *
   * The injection bus reaches all of them, so all of them can carry the user's
   * translated speech into the meeting — which makes "is the user muted" a
   * question about the whole set rather than about the newest member.
   */
  private readonly graphs = new Set<Graph>();

  constructor(private readonly deps: MicrophonePatchDeps) {}

  /**
   * Live graphs, with the ones the device took away dropped on the way past.
   *
   * Pruned here rather than watched: a client that abandons a graph without
   * stopping its track fires nothing, and a set that only grows would let one
   * dead preview mute the feature for the rest of the call.
   */
  private live(): Graph[] {
    const live: Graph[] = [];
    for (const graph of this.graphs) {
      if (graph.outgoing.readyState === 'live') live.push(graph);
      else this.graphs.delete(graph);
    }
    return live;
  }

  /** Where translated audio is mixed in. Null when nothing is composed. */
  get injectionPoint(): InjectionPoint | null {
    const graph = this.current;
    const context = this.context;
    const injection = this.injection;
    if (!graph || !context || !injection) return null;
    const live = () => this.live();
    return {
      context,
      injection,
      get graphs() {
        return live().map(({ destination, duck }) => ({ destination, duck }));
      },
      get transmitting() {
        // `enabled` is the meeting client's mute. Read rather than watched: an
        // assignment fires no event, and shadowing the property with our own
        // setter would break the silencing the client is relying on.
        const graphs = live();
        return graphs.length > 0 && graphs.every((each) => each.outgoing.enabled);
      },
    };
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
    // The user's own voice passes through a gain stage so their translation can
    // be heard over it, the same way the meeting's audio is ducked for them.
    // Their real voice keeps going out either way: the other participants hear
    // who is speaking, not only a synthetic voice.
    const duck = context.createGain();
    // Defaults to stereo while the device is almost always mono, which would
    // make `getSettings()` describe a track we are not handing over and give the
    // encoder a channel of silence.
    const channelCount = device.getSettings().channelCount;
    if (channelCount) destination.channelCount = channelCount;
    source.connect(duck);
    duck.connect(destination);

    const [outgoing] = destination.stream.getAudioTracks();
    if (!outgoing) return original;

    // Every composed track gets the bus, including ones the client asked for
    // earlier and may still be transmitting. Connected here rather than only for
    // the newest graph, which is the whole point — see {@link InjectionPoint}.
    this.injection ??= context.createGain();
    this.injection.connect(destination);

    const graph: Graph = { destination, source, duck, outgoing };
    this.graphs.add(graph);
    proxyTrack(outgoing, device, () => {
      // A stopped graph must not still be offered as somewhere to put audio.
      if (this.current === graph) this.current = null;
      this.graphs.delete(graph);
      // Nor kept on the bus: a client that opens and drops microphones through a
      // long call would otherwise leave the fan-out growing for the whole call.
      try {
        this.injection?.disconnect(destination);
      } catch {
        // Already disconnected. Web Audio throws rather than ignoring it.
      }
      // The microphone leaves the graph HERE and nowhere else.
      //
      // Cutting it on the next `compose` instead — which is what this did — reads
      // the newest call as proof the older graph is finished with. It is not: the
      // call goes on transmitting the track it joined with while a settings panel
      // or a device change composes a newer one, which is the same thing that
      // sent injected audio to a graph nobody heard. Cut there, the user's own
      // voice stops reaching the meeting the moment the client asks a second
      // time, and every indicator — the track, its state, `transmitting` — still
      // says the microphone is working. Only the client stopping a track says a
      // graph is done, and that is what this callback is.
      source.disconnect();
    });

    // The client asked for video in the same call often enough that dropping it
    // here would break the camera. Added to the destination's own stream rather
    // than built into a new one, so no `MediaStream` constructor is needed.
    for (const video of original.getVideoTracks()) destination.stream.addTrack(video);

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
