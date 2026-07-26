import { MAX_SAMPLE_RATE } from '@chatofy/types';
import { MAX_TURN_SECONDS, TurnAudio } from './turn-audio';
import { decodeWavToPcm16 } from '../audio/wav-codec';

const SAMPLE_RATE = 16000;
/** Mono PCM16: two bytes a sample. */
const BYTES_PER_SECOND = SAMPLE_RATE * 2;

const pcm = (bytes: number): Buffer => Buffer.alloc(bytes);

describe('TurnAudio', () => {
  it('derives bytes per second from its own rate', () => {
    expect(new TurnAudio(SAMPLE_RATE).bytesPerSecond).toBe(BYTES_PER_SECOND);
    expect(new TurnAudio(48000).bytesPerSecond).toBe(96000);
  });

  it('starts empty and reports what it has been given', () => {
    const audio = new TurnAudio(SAMPLE_RATE);
    expect(audio.isEmpty).toBe(true);

    audio.append(pcm(320));
    audio.append(pcm(160));

    expect(audio.isEmpty).toBe(false);
    expect(audio.byteLength).toBe(480);
  });

  // A frame may carry an empty payload while still fixing the sample rate, so
  // "has a buffer" and "has audio" are different questions.
  it('stays empty when handed no bytes', () => {
    const audio = new TurnAudio(SAMPLE_RATE);
    audio.append(pcm(0));
    expect(audio.isEmpty).toBe(true);
    expect(audio.byteLength).toBe(0);
  });

  it('converts a byte offset to seconds of speech', () => {
    const audio = new TurnAudio(SAMPLE_RATE);
    expect(audio.secondsAt(BYTES_PER_SECOND * 5)).toBe(5);
  });

  describe('toWav', () => {
    it('round-trips the whole buffer through the decoder', () => {
      const audio = new TurnAudio(SAMPLE_RATE);
      audio.append(pcm(400));
      audio.append(pcm(600));

      const decoded = decodeWavToPcm16(audio.toWav());

      expect(decoded.sampleRate).toBe(SAMPLE_RATE);
      expect(decoded.channels).toBe(1);
      expect(decoded.samples).toHaveLength(1000);
    });

    it('reads only from the offset it is given', () => {
      const audio = new TurnAudio(SAMPLE_RATE);
      audio.append(pcm(1000));

      const decoded = decodeWavToPcm16(audio.toWav(600));

      expect(decoded.samples).toHaveLength(400);
    });

    // Cutting between the two bytes of a 16-bit sample shifts every sample
    // after it and turns speech into noise, so the offset must stay even.
    it('keeps whole samples when the window starts mid-buffer', () => {
      const audio = new TurnAudio(SAMPLE_RATE);
      const samples = Buffer.alloc(8);
      samples.writeInt16LE(1000, 0);
      samples.writeInt16LE(2000, 2);
      samples.writeInt16LE(3000, 4);
      samples.writeInt16LE(4000, 6);
      audio.append(samples);

      const decoded = decodeWavToPcm16(audio.toWav(4));

      expect(decoded.samples.readInt16LE(0)).toBe(3000);
      expect(decoded.samples.readInt16LE(2)).toBe(4000);
    });
  });

  describe('the turn-length cap', () => {
    // Sized from the contract ceiling, never from the rate the client reported.
    const CAP = MAX_SAMPLE_RATE * 2 * MAX_TURN_SECONDS;

    it('allows a turn right up to the ceiling', () => {
      const audio = new TurnAudio(SAMPLE_RATE);
      expect(audio.wouldExceedCap(CAP)).toBe(false);
      expect(audio.wouldExceedCap(CAP + 1)).toBe(true);
    });

    it('counts what is already buffered', () => {
      const audio = new TurnAudio(SAMPLE_RATE);
      audio.append(pcm(1000));
      expect(audio.wouldExceedCap(CAP - 1000)).toBe(false);
      expect(audio.wouldExceedCap(CAP - 999)).toBe(true);
    });

    // The whole point of deriving it from MAX_SAMPLE_RATE: a client that
    // reports a low rate must not get a proportionally smaller ceiling, and one
    // reporting a high rate must not get a larger one.
    it('does not scale with the rate the client reported', () => {
      const slow = new TurnAudio(8000);
      const fast = new TurnAudio(MAX_SAMPLE_RATE);
      expect(slow.wouldExceedCap(CAP)).toBe(false);
      expect(fast.wouldExceedCap(CAP)).toBe(false);
      expect(slow.wouldExceedCap(CAP + 1)).toBe(true);
      expect(fast.wouldExceedCap(CAP + 1)).toBe(true);
    });
  });
});
