import { describe, expect, it, vi } from 'vitest';
import { ProviderAbortedError } from '@chatofy/ai-providers';
import { deliverStreamedSpeech } from './streamed-speech-delivery';
import { OUTBOUND_FRAME_MS } from './outbound-audio-framer';

const RATE = 48000;
const bytesFor = (ms: number) => Math.round((RATE * ms) / 1000) * 2;

async function* chunksOf(parts: Buffer[], failWith?: Error) {
  for (const part of parts) yield new Uint8Array(part);
  if (failWith) throw failWith;
}

function harness(parts: Buffer[], failWith?: Error) {
  const frames: { sequence: number; payload: Buffer; sampleRate: number }[] =
    [];
  let sequence = 0;
  let clock = 1_000;
  return {
    frames,
    run: (stillWanted: () => boolean = () => true) =>
      deliverStreamedSpeech({
        stream: {
          encoding: 'pcm16',
          sampleRate: RATE,
          chunks: chunksOf(parts, failWith),
        },
        sessionId: 's1',
        emit: (frame) =>
          frames.push({
            sequence: frame.sequence,
            payload: Buffer.from(frame.payload, 'base64'),
            sampleRate: frame.sampleRate,
          }),
        nextSequence: () => sequence++,
        stillWanted,
        fail: (err) => {
          throw err;
        },
        now: () => (clock += 10),
      }),
  };
}

describe('deliverStreamedSpeech', () => {
  it('never splits a sample across frames when the network does', async () => {
    const audio = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const { frames, run } = harness([
      audio.subarray(0, 3),
      audio.subarray(3, 4),
      audio.subarray(4),
    ]);

    await run();

    expect(frames.every((f) => f.payload.length % 2 === 0)).toBe(true);
    expect(Buffer.concat(frames.map((f) => f.payload))).toEqual(audio);
  });

  it('fails a stream that ends between the two bytes of a sample', async () => {
    const { frames, run } = harness([Buffer.from([1, 2, 3])]);

    await expect(run()).rejects.toThrow(/mid-sample/);
    // The whole sample before the cut still went out; only the half did not.
    expect(Buffer.concat(frames.map((f) => f.payload))).toEqual(
      Buffer.from([1, 2]),
    );
  });

  it('sends each chunk at once in frames of at most 200ms', async () => {
    const { frames, run } = harness([Buffer.alloc(bytesFor(320), 1)]);

    await run();

    // 320ms arrives, 320ms leaves — as 200 + 120, not 200 now and 120 later.
    expect(frames.map((f) => f.payload.length)).toEqual([
      bytesFor(OUTBOUND_FRAME_MS),
      bytesFor(120),
    ]);
    expect(frames.every((f) => f.sampleRate === RATE)).toBe(true);
  });

  it('numbers frames in order across chunks', async () => {
    const { frames, run } = harness([
      Buffer.alloc(bytesFor(250)),
      Buffer.alloc(bytesFor(250)),
    ]);

    await run();

    expect(frames.map((f) => f.sequence)).toEqual([0, 1, 2, 3]);
  });

  it('reports when the first and last audio went out', async () => {
    const { run } = harness([Buffer.alloc(4), Buffer.alloc(4)]);

    await expect(run()).resolves.toEqual({
      firstAudioAt: 1_010,
      lastAudioAt: 1_030,
    });
  });

  it('stops at the next chunk once the listener has gone', async () => {
    const { frames, run } = harness([
      Buffer.alloc(4),
      Buffer.alloc(4),
      Buffer.alloc(4),
    ]);
    const stillWanted = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);

    const delivery = await run(stillWanted);

    expect(delivery.stoppedBy).toBe('client_gone');
    expect(frames).toHaveLength(1);
  });

  it('treats the caller aborting mid-stream as the listener leaving', async () => {
    const { run } = harness(
      [Buffer.alloc(4)],
      new ProviderAbortedError('aborted by caller'),
    );

    await expect(run()).resolves.toMatchObject({ stoppedBy: 'client_gone' });
  });

  it('fails the turn when the stream breaks part-way', async () => {
    const broken = new Error('Local TTS stream failed');
    const { frames, run } = harness([Buffer.alloc(4)], broken);

    await expect(run()).rejects.toBe(broken);
    expect(frames).toHaveLength(1);
  });
});
