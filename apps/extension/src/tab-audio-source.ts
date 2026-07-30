/**
 * Turns a `tabCapture` stream id into a live MediaStream, and hands back the tab's
 * own audio so it can be heard again.
 *
 * The detail that catches people: capturing a tab MUTES it for the user. The
 * browser hands the audio to the extension instead of the speakers, so an extension
 * that captures and does not play the stream back leaves the meeting silent. That
 * requirement turns out to be a gift — the original audio now has to pass through
 * an `AudioContext` we own, which is exactly where a gain node has to sit for
 * ducking to be possible at all. See `duck-controller.ts`.
 *
 * The stream id is single-use and short-lived. It is minted by the service worker
 * (only it can call `getMediaStreamId`) and consumed here within the same
 * user gesture; a stale one fails at `getUserMedia` rather than at the call that
 * produced it.
 */

/** The tab's audio, and the node its sound arrives on. */
export interface TabAudioSource {
  stream: MediaStream;
  node: MediaStreamAudioSourceNode;
}

/**
 * Open the captured tab stream inside a context we control.
 *
 * `chromeMediaSource: 'tab'` is not in the standard constraint set, hence the cast:
 * these are Chrome's own extension constraints and no DOM typing describes them.
 */
export async function openTabAudio(
  context: AudioContext,
  streamId: string,
): Promise<TabAudioSource> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    // Video is not requested. Asking for it and ignoring it would keep a video
    // encoder alive for the whole meeting.
    video: false,
  } as unknown as MediaStreamConstraints);

  return { stream, node: context.createMediaStreamSource(stream) };
}

/**
 * A microphone stream for measuring echo, not for translating.
 *
 * Opened with the browser's own cleanup ON. That looks wrong for a measurement, and
 * is not: the question being answered is how much of our own playback comes back
 * through the microphone IN THE CONFIGURATION SOMEONE WOULD ACTUALLY USE, and a
 * meeting client always has these enabled. Measuring with them off would produce a
 * larger, truer-looking number that describes a setup nobody runs.
 */
export function openEchoMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}
