import { describe, expect, it } from 'vitest';
import { decodeWavToPcm16, encodePcm16Wav, WavFormatError } from './wav-codec';

/**
 * A recognisable PCM16 sawtooth — a wrong offset or sample width shows up as a
 * shift. Wraps within the signed 16-bit range so long buffers stay writable.
 */
const pcm = (sampleCount: number): Buffer => {
  const buf = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    buf.writeInt16LE(((i * 337) % 65536) - 32768, i * 2);
  }
  return buf;
};

describe('wav-codec', () => {
  it('round-trips samples, rate and channel count', () => {
    const samples = pcm(500);
    const decoded = decodeWavToPcm16(
      encodePcm16Wav({ samples, sampleRate: 16000, channels: 1 }),
    );

    expect(decoded.samples.equals(samples)).toBe(true);
    expect(decoded.sampleRate).toBe(16000);
    expect(decoded.channels).toBe(1);
  });

  it('writes a 44-byte canonical header', () => {
    const wav = encodePcm16Wav({
      samples: pcm(10),
      sampleRate: 24000,
      channels: 1,
    });

    expect(wav.length).toBe(44 + 20);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    // RIFF size counts everything after the first 8 bytes.
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    expect(wav.readUInt32LE(28)).toBe(24000 * 2); // byte rate, mono 16-bit
    expect(wav.readUInt32LE(40)).toBe(20); // data chunk size
  });

  // Encoders may emit metadata before `data`, so a fixed 44-byte skip would
  // read that metadata as audio.
  it('finds the data chunk past an interposed LIST chunk', () => {
    const samples = pcm(8);
    const canonical = encodePcm16Wav({
      samples,
      sampleRate: 16000,
      channels: 1,
    });
    const list = Buffer.alloc(8 + 4);
    list.write('LIST', 0, 'ascii');
    list.writeUInt32LE(4, 4);
    list.write('INFO', 8, 'ascii');

    const withList = Buffer.concat([
      canonical.subarray(0, 36), // RIFF descriptor + fmt chunk
      list,
      canonical.subarray(36), // data chunk
    ]);
    withList.writeUInt32LE(withList.length - 8, 4);

    expect(decodeWavToPcm16(withList).samples.equals(samples)).toBe(true);
  });

  it('recovers audio when the data chunk size was never finalised', () => {
    const samples = pcm(16);
    const wav = encodePcm16Wav({ samples, sampleRate: 16000, channels: 1 });
    wav.writeUInt32LE(0, 40); // a streaming writer that never went back

    expect(decodeWavToPcm16(wav).samples.equals(samples)).toBe(true);
  });

  it('stops walking once an unfinished data chunk claims the rest', () => {
    // Audio that happens to spell a chunk id would otherwise be parsed as a
    // header and overwrite what was already read.
    const samples = Buffer.concat([
      Buffer.from('data'),
      Buffer.alloc(4, 0xff), // a huge declared size, if it were read as a header
      pcm(8),
    ]);
    const wav = encodePcm16Wav({ samples, sampleRate: 16000, channels: 1 });
    wav.writeUInt32LE(0, 40);

    expect(decodeWavToPcm16(wav).samples.equals(samples)).toBe(true);
  });

  describe('rejects payloads it must not reinterpret', () => {
    it('rejects a non-RIFF payload', () => {
      expect(() => decodeWavToPcm16(Buffer.from('ID3 not a wav file'))).toThrow(
        WavFormatError,
      );
    });

    // Silently treating float samples as PCM produces noise that sounds like a
    // broken model, so the width and encoding are checked rather than assumed.
    it('rejects IEEE-float WAVE', () => {
      const wav = encodePcm16Wav({
        samples: pcm(4),
        sampleRate: 16000,
        channels: 1,
      });
      wav.writeUInt16LE(3, 20); // WAVE_FORMAT_IEEE_FLOAT
      expect(() => decodeWavToPcm16(wav)).toThrow(/not uncompressed PCM/);
    });

    it('rejects a non-16-bit sample width', () => {
      const wav = encodePcm16Wav({
        samples: pcm(4),
        sampleRate: 16000,
        channels: 1,
      });
      wav.writeUInt16LE(24, 34);
      expect(() => decodeWavToPcm16(wav)).toThrow(/24-bit/);
    });

    // Both are divisors when samples are cut into playable frames, so a zero
    // would produce an endless loop rather than an error.
    it('rejects a WAVE declaring zero channels', () => {
      const wav = encodePcm16Wav({
        samples: pcm(4),
        sampleRate: 16000,
        channels: 1,
      });
      wav.writeUInt16LE(0, 22);
      expect(() => decodeWavToPcm16(wav)).toThrow(/0 channels/);
    });

    it('rejects a WAVE declaring a zero sample rate', () => {
      const wav = encodePcm16Wav({
        samples: pcm(4),
        sampleRate: 16000,
        channels: 1,
      });
      wav.writeUInt32LE(0, 24);
      expect(() => decodeWavToPcm16(wav)).toThrow(/sample rate of 0/);
    });

    it('rejects a WAVE with no data chunk', () => {
      const wav = encodePcm16Wav({
        samples: pcm(4),
        sampleRate: 16000,
        channels: 1,
      });
      expect(() => decodeWavToPcm16(wav.subarray(0, 36))).toThrow(
        /no data chunk/,
      );
    });
  });
});
