import { base64ToPcm16, PcmPlaybackQueue } from '@chatofy/realtime-client';
import { DuckController } from '../../src/duck-controller';
import { MicrophonePatch, type InjectionPoint } from '../../src/microphone-patch';
import { asCommand, type OutboundReport } from '../../src/outbound-channel';

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

    /** Built on the first frame, and rebuilt whenever the graph is replaced. */
    let speaking: { point: InjectionPoint; queue: PcmPlaybackQueue; duck: DuckController } | null =
      null;

    const speaker = () => {
      const point = patch.injectionPoint;
      if (!point) return null;
      if (speaking?.point.destination === point.destination) return speaking;

      // A device change gives the client a new track from a new graph. Audio
      // scheduled into the old one is transmitted to nobody, while every signal
      // on this side still looks healthy.
      speaking?.queue.stop();
      speaking?.duck.release();

      const duck = new DuckController(point.context);
      // Disconnected first. The patch wires the user's voice straight to the
      // destination so it flows with no page script at all; inserting the
      // controller without cutting that edge leaves the microphone reaching the
      // meeting through TWO paths — summed to roughly double, and only one of
      // them ducking, so the translation never rises above the voice under it.
      point.duck.disconnect();
      duck.connect(point.duck, point.destination);
      speaking = {
        point,
        duck,
        // The scheduler is the one the rest of the project uses. A second copy
        // of turn scheduling is what `@chatofy/realtime-client` exists to avoid,
        // and this one is on someone else's page where it could not be tested.
        queue: new PcmPlaybackQueue(point.context, () => duck.setBusy(false), point.destination),
      };
      return speaking;
    };

    const report = (message: OutboundReport) => window.postMessage(message, window.origin);

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const command = asCommand(event.data);
      if (!command) return;

      if (command.type === 'chatofy:silence') {
        speaking?.queue.stop();
        speaking?.duck.setBusy(false);
        return;
      }
      if (command.type === 'chatofy:drop') {
        speaking?.queue.stopTurn(command.turnKey);
        // `stopTurn` cancels the drain callback along with the audio, so nothing
        // would ever release the duck. The user's own voice would stay lowered
        // into the meeting until some later turn happened to finish.
        if (speaking && !speaking.queue.isPlaying) speaking.duck.setBusy(false);
        return;
      }

      const live = speaker();
      if (!live) return;
      live.duck.setBusy(true);
      live.queue.enqueue(command.turnKey, base64ToPcm16(command.payload), command.sampleRate);
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
