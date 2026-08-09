import { base64ToPcm16, PcmPlaybackQueue } from '@chatofy/realtime-client';
import { DuckController } from '../../src/duck-controller';
import { MicrophonePatch } from '../../src/microphone-patch';
import { asCommand, type OutboundReport } from '../../src/outbound-channel';
import { VoiceLease } from '../../src/outbound-voice-lease';

/**
 * The one piece of Chatofy that runs in the meeting page's own world.
 *
 * It is here because there is nowhere else: the outgoing microphone belongs to
 * the page, and an extension cannot reach it from anywhere that is not the page.
 * It wraps `getUserMedia`, hands the client a track fed by a graph we own, and
 * speaks the user's translated sentences into that graph.
 *
 * `registration: 'runtime'` — this is NOT in the manifest, and is registered by
 * the service worker only while the user has the outbound direction switched on.
 * A statically declared version would run for everyone who installs the
 * extension, on every meeting they open, replacing the microphone of people who
 * never asked for this. It would also be detectable in one line
 * (`Object.getOwnPropertyDescriptor(navigator.mediaDevices, 'getUserMedia')`),
 * letting all three sites fingerprint every Chatofy user — reopening, by another
 * door, exactly what `wxt.config.ts` declines `web_accessible_resources` to keep
 * shut.
 *
 * **This world cannot hold a secret**, and that is measured rather than assumed.
 * An earlier design transferred a `MessagePort` here at `document_start`, on the
 * reasoning that no page script had run yet; the end-to-end harness showed a
 * script in the page's own `<head>` receiving both the message and the port,
 * because `window.postMessage` queues a task rather than delivering
 * synchronously. So everything here is written on the basis that the page reads
 * what arrives and could send the same thing itself:
 *
 *   - nothing confidential is sent here. The audio is the user's own translated
 *     speech, which the page is about to transmit — and the extension stops
 *     sending the moment the client mutes, which is the case where it would not.
 *   - nothing this reports is trusted. Turn order and lifetime are decided in
 *     the offscreen document, which asks this side nothing.
 *   - a page could inject audio of its own. It could also mix anything it liked
 *     into the stream it already controls, with or without this extension, so
 *     that is not a capability being handed over.
 */
export default defineContentScript({
  // Must stay in step with `host_permissions` and `supportOf` in
  // `src/supported-meeting-url.ts`. WXT reads this statically, so it cannot be
  // imported from there.
  matches: [
    'https://meet.google.com/*',
    'https://*.zoom.us/wc/*',
    'https://*.facebook.com/groupcall/*',
  ],
  world: 'MAIN',
  // Before the page's own code can call `getUserMedia`.
  runAt: 'document_start',
  registration: 'runtime',
  // WXT otherwise announces itself to the page over `window.postMessage`. On a
  // script whose whole point is to be quiet, that announcement is a tell.
  noScriptStartedPostMessage: true,
  main() {
    const patch = new MicrophonePatch({
      createContext: () => new AudioContext(),
      // Into the page's console, because that is the only one that exists here.
      // Prefixed, because it is someone else's console.
      onLog: (message) => console.info(`[chatofy] ${message}`),
    });
    patch.install(navigator.mediaDevices);

    /**
     * The gate on the user's own voice, one per composed track.
     *
     * Every live graph gets one, not merely the newest. The injection is a bus
     * reaching all of them, so the translation comes out of whichever track the
     * client is transmitting — and the voice it replaces has to be gated on that
     * same one. Gating only the newest left both voices at full level on the
     * track the meeting actually carried.
     *
     * Zero rather than the meeting's 0.2 duck. While a capture is sending, the
     * other participants hear the translation and nothing else: the two voices
     * are the same person five seconds apart, and lowering one under the other
     * does not make that followable, it only makes it quieter.
     */
    const gates = new Map<MediaStreamAudioDestinationNode, DuckController>();
    /** Built once: the patch keeps one context, and the bus outlives every graph. */
    let queue: PcmPlaybackQueue | null = null;

    /**
     * Whether the meeting hears the user themselves.
     *
     * Held down only while the extension keeps saying so. A renewal that stops
     * arriving gives the voice back on its own, so an offscreen document that
     * dies cannot leave the microphone shut in a live meeting.
     */
    const voice = new VoiceLease({ onChange: (mine) => applyVoice(mine) });

    const applyVoice = (mine: boolean) => {
      for (const gate of gates.values()) gate.setBusy(!mine);
    };

    /** Reconcile the gates with the graphs the client currently holds. */
    const syncGates = () => {
      const point = patch.injectionPoint;
      if (!point) return null;

      const live = new Set<MediaStreamAudioDestinationNode>();
      for (const graph of point.graphs) {
        live.add(graph.destination);
        if (gates.has(graph.destination)) continue;
        const gate = new DuckController(point.context, 0);
        // Disconnected first. The patch wires the user's voice straight to the
        // destination so it flows with no page script at all; inserting the gate
        // without cutting that edge leaves the microphone reaching the meeting
        // through TWO paths, only one of them gated — so closing it would lower
        // the voice rather than remove it.
        graph.duck.disconnect();
        gate.connect(graph.duck, graph.destination);
        gates.set(graph.destination, gate);
        // A device changed mid-session composes a graph the lease never reached.
        // Left open, the user's real voice returns to the meeting underneath
        // their translation for the rest of the call.
        if (!voice.mine) gate.setBusy(true);
      }
      // A graph the client stopped takes its gate with it, so a call that changes
      // devices repeatedly does not accumulate release timers.
      for (const [destination, gate] of gates) {
        if (live.has(destination)) continue;
        gate.disconnect();
        gates.delete(destination);
      }

      // The scheduler is the one the rest of the project uses. A second copy of
      // turn scheduling is what `@chatofy/realtime-client` exists to avoid, and
      // this one is on someone else's page where it could not be tested.
      queue ??= new PcmPlaybackQueue(point.context, () => {}, point.injection);
      return { queue };
    };

    const report = (message: OutboundReport) => window.postMessage(message, window.origin);

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const command = asCommand(event.data);
      if (!command) return;

      if (command.type === 'chatofy:voice') {
        // The gates have to exist before the lease can close them: the first
        // renewal arrives when the capture starts, which is before any audio.
        syncGates();
        if (command.mine) voice.release();
        else voice.renew();
        return;
      }
      if (command.type === 'chatofy:silence') {
        queue?.stop();
        return;
      }
      if (command.type === 'chatofy:drop') {
        queue?.stopTurn(command.turnKey);
        return;
      }

      const speaking = syncGates();
      if (!speaking) return;
      speaking.queue.enqueue(command.turnKey, base64ToPcm16(command.payload), command.sampleRate);
    });

    // Polled, because `enabled` is assigned rather than raised as an event and
    // shadowing it would break the client's own mute. Cheap, and the answer
    // decides whether the extension is allowed to keep translating: a user who
    // muted themselves to say something private must not have it sent here.
    //
    // Restated on a heartbeat as well as on change, and that is not belt and
    // braces. This script starts when the PAGE loads; the offscreen document
    // starts when the user invokes capture, which is later, and it begins by
    // assuming muted. An edge-triggered report has already been sent by then, so
    // without the heartbeat the outbound direction stays gated shut for the whole
    // call while the overlay reports it as sending.
    const HEARTBEAT_TICKS = 8;
    let transmitting: boolean | null = null;
    let ticks = 0;
    setInterval(() => {
      const point = patch.injectionPoint;
      const now = point ? point.transmitting : false;
      ticks += 1;
      if (now === transmitting && ticks % HEARTBEAT_TICKS !== 0) return;
      transmitting = now;
      report({ type: 'chatofy:transmitting', transmitting: now });
    }, 250);
  },
});
