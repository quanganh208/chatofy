import type { ServerEvent } from '@chatofy/types';
import { Logger } from '@nestjs/common';
import {
  frameSynthesizedWav,
  OUTBOUND_FRAME_MS,
  pushSynthesizedWav,
  pushTranslatedPcm,
} from './outbound-audio-framer';
import { EventChannel } from './event-channel';
import { TurnSession } from './turn-session';
import type { StreamSocket } from './stream-socket';
import { encodePcm16Wav } from '../audio/wav-codec';

/** A turn whose output voice is beside the point for the behavior under test. */
const openSession = () =>
  new TurnSession({
    direction: 'vi_to_en',
    voiceGender: 'female',
    streaming: false,
  });

const TTS_SAMPLE_RATE = 24000;

/** WAV of `ms` milliseconds, as the TTS sidecar would return it. */
const ttsWav = (ms: number): Buffer =>
  encodePcm16Wav({
    samples: Buffer.alloc(Math.round((TTS_SAMPLE_RATE * ms) / 1000) * 2),
    sampleRate: TTS_SAMPLE_RATE,
    channels: 1,
  });

class FakeSocket implements StreamSocket {
  readonly sent: ServerEvent[] = [];
  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerEvent);
  }
}

const channelFor = (socket: StreamSocket) =>
  new EventChannel(socket, { warn: jest.fn() } as unknown as Logger);

describe('frameSynthesizedWav', () => {
  it('cuts a second of speech into frames of the configured length', () => {
    const framed = frameSynthesizedWav(ttsWav(1000));

    expect(framed.ok).toBe(true);
    if (!framed.ok) return;
    expect(framed.sampleRate).toBe(TTS_SAMPLE_RATE);
    expect([...framed.frames]).toHaveLength(1000 / OUTBOUND_FRAME_MS);
  });

  it('sizes each frame from the rate the payload declares', () => {
    const framed = frameSynthesizedWav(ttsWav(1000));
    if (!framed.ok) throw new Error('expected framing to succeed');

    const [first] = [...framed.frames];
    // 200ms of 24 kHz mono 16-bit.
    expect(first).toHaveLength(9600);
  });

  // The ElevenLabs backend returns audio/mpeg, which is not a container this
  // path can unwrap.
  it('explains a payload it cannot unwrap instead of throwing', () => {
    const framed = frameSynthesizedWav(Buffer.from('ID3 mp3 payload'));

    expect(framed.ok).toBe(false);
    if (framed.ok) return;
    expect(framed.detail).toContain('RIFF');
  });

  // Materializing every frame would hold the base64 inflation of a whole clause
  // at once, which is the allocation this iterator exists to avoid.
  it('produces frames lazily', () => {
    const framed = frameSynthesizedWav(ttsWav(1000));
    if (!framed.ok) throw new Error('expected framing to succeed');

    const iterator = framed.frames[Symbol.iterator]();
    expect(iterator.next().done).toBe(false);

    // Pulling one frame advanced the iterator rather than materializing an
    // array: the four that remain are produced on demand from where it stopped.
    let remaining = 0;
    while (iterator.next().done !== true) remaining += 1;
    expect(remaining).toBe(4);
  });
});

describe('pushSynthesizedWav', () => {
  it('numbers frames from the turn, continuing across calls', () => {
    const socket = new FakeSocket();
    const session = openSession();

    expect(
      pushSynthesizedWav(channelFor(socket), session, ttsWav(400)).ok,
    ).toBe(true);
    expect(
      pushSynthesizedWav(channelFor(socket), session, ttsWav(400)).ok,
    ).toBe(true);

    const frames = socket.sent
      .filter((e) => e.type === 'server.audio.frame')
      .map((e) => e.frame);

    expect(frames.map((f) => f.sequence)).toEqual([0, 1, 2, 3]);
    for (const frame of frames) {
      expect(frame.sessionId).toBe(session.sessionId);
      expect(frame.encoding).toBe('pcm16');
      expect(frame.sampleRate).toBe(TTS_SAMPLE_RATE);
    }
  });

  it('sends nothing at all when the payload could not be framed', () => {
    const socket = new FakeSocket();
    const session = openSession();

    const result = pushSynthesizedWav(
      channelFor(socket),
      session,
      Buffer.from('ID3 mp3 payload'),
    );

    expect(result.ok).toBe(false);
    expect(socket.sent).toHaveLength(0);
  });
});

/**
 * The headerless sibling, used by the continuous path.
 *
 * Separate from the WAV tests above because the input is different in kind: the
 * speech-to-speech backend answers with raw PCM and a rate that travels beside
 * it, so there is no container to strip and nothing that can fail to parse.
 */
describe('pushTranslatedPcm', () => {
  /** Collects the frames the caller would have put on the wire. */
  function collect(pcm: Buffer, rate: number) {
    const frames: { sampleRate: number; sequence: number; payload: string }[] =
      [];
    let sequence = 0;
    pushTranslatedPcm(
      (frame) => frames.push(frame),
      'session-1',
      () => sequence++,
      pcm,
      rate,
    );
    return frames;
  }

  it('slices 24 kHz PCM into frames of OUTBOUND_FRAME_MS', () => {
    // 500ms at 24kHz mono 16-bit = 24000 bytes → 200/200/100ms.
    const frames = collect(Buffer.alloc(24000), 24000);

    expect(frames).toHaveLength(3);
    const bytesPer200ms = ((24000 * OUTBOUND_FRAME_MS) / 1000) * 2;
    expect(Buffer.from(frames[0]!.payload, 'base64')).toHaveLength(
      bytesPer200ms,
    );
    // The tail is short rather than padded: padding would add silence the
    // backend never produced, and a listener hears that as a gap.
    expect(Buffer.from(frames[2]!.payload, 'base64')).toHaveLength(
      bytesPer200ms / 2,
    );
  });

  it('carries the backend rate, not the input rate', () => {
    // The client sends 16 kHz; this backend answers at 24 kHz. A frame that
    // claimed the input rate would play back a third too slow.
    expect(
      collect(Buffer.alloc(9600), 24000).every((f) => f.sampleRate === 24000),
    ).toBe(true);
    expect(
      collect(Buffer.alloc(9600), 16000).every((f) => f.sampleRate === 16000),
    ).toBe(true);
  });

  it('numbers frames through the caller sequence', () => {
    expect(collect(Buffer.alloc(24000), 24000).map((f) => f.sequence)).toEqual([
      0, 1, 2,
    ]);
  });

  it('emits nothing for an empty chunk', () => {
    expect(collect(Buffer.alloc(0), 24000)).toEqual([]);
  });
});
