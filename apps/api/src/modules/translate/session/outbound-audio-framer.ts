import { decodeWavToPcm16, WavFormatError } from '../audio/wav-codec';
import type { EventChannel } from './event-channel';
import type { TurnSession } from './turn-session';

/**
 * Outbound audio chunk length. Short enough that playback can start well before
 * synthesis has been fully delivered, long enough that a turn does not become
 * hundreds of JSON frames.
 */
export const OUTBOUND_FRAME_MS = 200;

/**
 * `frames` is an `IterableIterator` rather than a plain `Iterable` because it is
 * single-use: it is a generator, so a second walk over the same result yields
 * nothing. Saying so in the type stops a later caller from iterating twice and
 * silently dropping a clause's audio.
 */
export type FramingResult =
  | { ok: true; sampleRate: number; frames: IterableIterator<Buffer> }
  | { ok: false; detail: string };

/**
 * Views onto the decoded samples, produced one at a time.
 *
 * Lazy rather than an array on purpose. The caller base64-encodes each frame as
 * it sends it, which costs a third more memory than the slice; materializing
 * every frame first would hold that inflation for the whole clause at once,
 * alongside the PCM it was derived from, on a path that takes no authentication.
 */
function* sliceFrames(
  samples: Buffer,
  bytesPerFrame: number,
): Generator<Buffer> {
  for (let offset = 0; offset < samples.length; offset += bytesPerFrame) {
    yield samples.subarray(offset, offset + bytesPerFrame);
  }
}

/** Outcome of trying to put one clause's synthesized audio on the wire. */
export type PushResult = { ok: true } | { ok: false; detail: string };

/**
 * Push one clause's synthesized audio to the client, frame by frame.
 *
 * Nothing is sent when the payload could not be framed, so the caller can
 * report the backend's format instead of emitting noise. Each frame is
 * base64-encoded as it is pulled, which is the point of the lazy iterator
 * above — the encoded copy of a whole clause never exists at once.
 */
export function pushSynthesizedWav(
  channel: EventChannel,
  session: TurnSession,
  audio: Buffer,
): PushResult {
  const framed = frameSynthesizedWav(audio);
  if (!framed.ok) return framed;

  for (const slice of framed.frames) {
    channel.emit({
      type: 'server.audio.frame',
      frame: {
        sessionId: session.sessionId,
        encoding: 'pcm16',
        sampleRate: framed.sampleRate,
        sequence: session.nextOutboundSequence(),
        timestamp: Date.now(),
        payload: slice.toString('base64'),
      },
    });
  }
  return { ok: true };
}

/**
 * Split synthesized audio into raw PCM frames, or say why it could not be done.
 *
 * The shared contract carries samples, not containers, so the WAV the TTS
 * sidecar returns is unwrapped here. A backend that emits anything else — the
 * ElevenLabs path returns `audio/mpeg` — cannot feed this route, and saying so
 * beats shipping frames the client would decode as noise.
 */
export function frameSynthesizedWav(audio: Buffer): FramingResult {
  let pcm;
  try {
    pcm = decodeWavToPcm16(audio);
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof WavFormatError ? err.message : String(err),
    };
  }

  const bytesPerFrame =
    Math.max(1, Math.round((pcm.sampleRate * OUTBOUND_FRAME_MS) / 1000)) *
    pcm.channels *
    2;

  return {
    ok: true,
    sampleRate: pcm.sampleRate,
    frames: sliceFrames(pcm.samples, bytesPerFrame),
  };
}
