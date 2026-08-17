import { Logger } from '@nestjs/common';
import type { SttStreamSession } from '@chatofy/ai-providers';
import { CausalTranscriber } from './causal-transcriber';
import type { PipelineTranslatorService } from '../services/pipeline-translator.service';
import type { TurnSession } from './turn-session';

/**
 * The running transcript the commit path speaks from.
 *
 * What every test here is really guarding is one property: audio reaches the
 * decoder exactly once, in order. Break that and the decoder's append-only
 * guarantee goes with it — which is the whole reason this engine was chosen and
 * the reason the previous arrangement, re-reading a growing window, silently was
 * not delivering it.
 */

class FakeStream implements SttStreamSession {
  readonly fed: string[] = [];
  closes = 0;
  finalizes = 0;
  failFeed: Error | null = null;
  /** Scripted deltas, for tests about where words begin and end. */
  deltas: string[] | null = null;

  async feed(chunk: Uint8Array): Promise<string> {
    if (this.failFeed) throw this.failFeed;
    const text = Buffer.from(chunk).toString('utf8');
    this.fed.push(text);
    if (this.deltas) {
      await new Promise((resolve) => setImmediate(resolve));
      return this.deltas.shift() ?? '';
    }
    // A tick of latency, so a second feed arriving during this one has a real
    // chance to overlap rather than being serialized by the event loop.
    await new Promise((resolve) => setImmediate(resolve));
    // Trailing space, because a real decoder's delta carries the boundary that
    // says a word finished. Without one, nothing here would ever settle — which
    // is the behaviour, not a quirk of the fake.
    return `[${text}] `;
  }

  async finalize(): Promise<string> {
    this.finalizes += 1;
    return '<tail>';
  }

  async close(): Promise<void> {
    this.closes += 1;
  }
}

/** Just enough turn to answer "what audio is there, and how much is new". */
function fakeSession(bytes: string, sampleRate = 16000): TurnSession {
  const buffer = Buffer.from(bytes, 'utf8');
  return {
    direction: 'vi_to_en',
    buffered: {
      byteLength: buffer.length,
      sampleRate,
      pcmFrom: (from: number) => buffer.subarray(from),
    },
  } as unknown as TurnSession;
}

function makePipeline(stream: SttStreamSession | null): {
  pipeline: PipelineTranslatorService;
  opens: number;
} {
  const state = { opens: 0 };
  const pipeline = {
    openTranscriptStream: jest.fn(async () => {
      state.opens += 1;
      return stream;
    }),
  } as unknown as PipelineTranslatorService;
  return {
    pipeline,
    get opens() {
      return state.opens;
    },
  };
}

const silentLogger = () =>
  ({ warn: () => {}, debug: () => {}, log: () => {} }) as unknown as Logger;

describe('CausalTranscriber', () => {
  it('sends only audio the decoder has not seen, and appends what comes back', async () => {
    // The property that makes a 45s turn cost what a 5s turn costs per second.
    // The window re-read this replaces decoded the last 8 seconds again on every
    // tick, so a long turn spent cores on audio it had already understood.
    const stream = new FakeStream();
    const { pipeline } = makePipeline(stream);
    const causal = new CausalTranscriber(pipeline, silentLogger());

    expect(await causal.onAudio(fakeSession('aaa'))).toBe('[aaa]');
    expect(await causal.onAudio(fakeSession('aaabbb'))).toBe('[aaa] [bbb]');

    expect(stream.fed).toEqual(['aaa', 'bbb']);
  });

  it('reports nothing when no new audio has arrived', async () => {
    const stream = new FakeStream();
    const { pipeline } = makePipeline(stream);
    const causal = new CausalTranscriber(pipeline, silentLogger());

    await causal.onAudio(fakeSession('aaa'));

    expect(await causal.onAudio(fakeSession('aaa'))).toBeNull();
    expect(stream.fed).toEqual(['aaa']);
  });

  it('opens one session however fast the frames arrive', async () => {
    // Frames arrive faster than a round trip. Without a shared opening promise a
    // turn would open several sessions and keep the last, leaving the others
    // holding decoder state nothing would ever close.
    const stream = new FakeStream();
    const opener = makePipeline(stream);
    const causal = new CausalTranscriber(opener.pipeline, silentLogger());

    await Promise.all([
      causal.onAudio(fakeSession('aaa')),
      causal.onAudio(fakeSession('aaabbb')),
      causal.onAudio(fakeSession('aaabbbccc')),
    ]);

    expect(opener.opens).toBe(1);
  });

  it('does not let two feeds overlap', async () => {
    // Out-of-order audio is unrecoverable for a causal decoder: it never re-reads,
    // so a chunk delivered late is a gap it will never learn about.
    const stream = new FakeStream();
    const { pipeline } = makePipeline(stream);
    const causal = new CausalTranscriber(pipeline, silentLogger());
    await causal.onAudio(fakeSession('aaa'));

    const [first, second] = await Promise.all([
      causal.onAudio(fakeSession('aaabbb')),
      causal.onAudio(fakeSession('aaabbbccc')),
    ]);

    // One of the two did the work; the other declined rather than racing it.
    expect([first, second].filter((r) => r !== null)).toHaveLength(1);
    expect(stream.fed).toEqual(['aaa', 'bbb']);
  });

  it('keeps unconsumed audio unconsumed when a feed fails', async () => {
    const stream = new FakeStream();
    const { pipeline } = makePipeline(stream);
    const causal = new CausalTranscriber(pipeline, silentLogger());
    stream.failFeed = new Error('sidecar down');

    expect(await causal.onAudio(fakeSession('aaa'))).toBeNull();

    // Disabled for the turn rather than retried forever, and the turn still gets
    // its endpoint translation.
    expect(causal.active).toBe(false);
    expect(causal.decided).toBe(true);
    expect(causal.text).toBe('');
  });

  it('is inert, not broken, when the backend offers no causal session', async () => {
    // English today, and Vietnamese after a rollback. The turn falls back to
    // being answered at its endpoint, exactly as before this path existed.
    const { pipeline } = makePipeline(null);
    const causal = new CausalTranscriber(pipeline, silentLogger());

    expect(await causal.onAudio(fakeSession('aaa'))).toBeNull();
    expect(causal.active).toBe(false);
    expect(causal.decided).toBe(true);
    expect(await causal.finalize()).toBe('');
  });

  it('is undecided until the first open resolves', async () => {
    // The window in which the re-read path must not also commit: two transcripts
    // of one utterance handed to one policy manufacture contradictions.
    const { pipeline } = makePipeline(new FakeStream());
    const causal = new CausalTranscriber(pipeline, silentLogger());

    const inFlight = causal.onAudio(fakeSession('aaa'));
    expect(causal.decided).toBe(false);

    await inFlight;
    expect(causal.decided).toBe(true);
    expect(causal.active).toBe(true);
  });

  it('flushes the tail into the running transcript', async () => {
    const stream = new FakeStream();
    const { pipeline } = makePipeline(stream);
    const causal = new CausalTranscriber(pipeline, silentLogger());
    await causal.onAudio(fakeSession('aaa'));

    // The tail carries the word that was being withheld, so `finalize` returns
    // more than the last `onAudio` did. That difference is the point of both.
    expect(await causal.finalize()).toBe('[aaa] <tail>');
    expect(stream.finalizes).toBe(1);
  });

  it('releases the decoder session on close, once', async () => {
    const stream = new FakeStream();
    const { pipeline } = makePipeline(stream);
    const causal = new CausalTranscriber(pipeline, silentLogger());
    await causal.onAudio(fakeSession('aaa'));

    await causal.close();
    await causal.close();

    expect(stream.closes).toBe(1);
  });

  it('flushes the tail only after a feed in flight has landed', async () => {
    // `end()` normally arrives a frame after the last feed was dispatched. The
    // sidecar serializes the two but does not preserve the order they were sent
    // in, so without waiting the tail can be appended before the audio it is the
    // tail of.
    const stream = new FakeStream();
    const { pipeline } = makePipeline(stream);
    const causal = new CausalTranscriber(pipeline, silentLogger());
    await causal.onAudio(fakeSession('aaa'));

    const feeding = causal.onAudio(fakeSession('aaabbb'));
    const text = await causal.finalize();
    await feeding;

    expect(text).toBe('[aaa] [bbb] <tail>');
  });

  it('withholds the word the decoder is still spelling', async () => {
    // The defect this exists for, measured rather than imagined: on a real turn
    // the running text went "n" -> "nó", "là" -> "làm", "d" -> "dân", and each
    // of those had already been committed and spoken. Appending deltas makes
    // the string monotone and says nothing about the words.
    const stream = new FakeStream();
    stream.deltas = ['xin ch', 'ào các', ' bạn'];
    const { pipeline } = makePipeline(stream);
    const causal = new CausalTranscriber(pipeline, silentLogger());

    // "ch" is half a word, so only "xin" is safe to say.
    expect(await causal.onAudio(fakeSession('a'))).toBe('xin');
    // "chào" is finished now and "các" is not, even though it looks like a word.
    expect(await causal.onAudio(fakeSession('ab'))).toBe('xin chào');
    expect(await causal.onAudio(fakeSession('abc'))).toBe('xin chào các');

    // Nothing spoken was ever taken back: each answer extends the last.
    expect(await causal.finalize()).toBe('xin chào các bạn<tail>');
  });

  it('says nothing at all until one word has finished', async () => {
    // Half a word is not a short transcript, it is a wrong one. Returning it
    // would hand the commit policy a token to speak that the next feed rewrites.
    const stream = new FakeStream();
    stream.deltas = ['ngư'];
    const { pipeline } = makePipeline(stream);
    const causal = new CausalTranscriber(pipeline, silentLogger());

    expect(await causal.onAudio(fakeSession('a'))).toBeNull();
  });

  it('still releases the sidecar session after a feed failed', async () => {
    // `fail()` drops the local handle, but the session is alive on the other
    // side of the wire. Losing it here means 60MB held until the reaper logs it
    // as a vanished client — a signal that is supposed to mean something else.
    const stream = new FakeStream();
    const { pipeline } = makePipeline(stream);
    const causal = new CausalTranscriber(pipeline, silentLogger());
    await causal.onAudio(fakeSession('aaa'));
    stream.failFeed = new Error('sidecar down');
    await causal.onAudio(fakeSession('aaabbb'));

    await causal.close();

    expect(stream.closes).toBe(1);
  });

  it('refuses the causal path at a sample rate the wire cannot describe', async () => {
    // The feed route takes bare PCM, so nothing in the payload carries a rate.
    // The contract accepts 8000-48000; a 48 kHz turn decoded as 16 kHz is played
    // aloud at three times speed.
    const stream = new FakeStream();
    const { pipeline } = makePipeline(stream);
    const causal = new CausalTranscriber(pipeline, silentLogger());

    expect(await causal.onAudio(fakeSession('aaa', 48000))).toBeNull();
    expect(causal.active).toBe(false);
    expect(stream.fed).toEqual([]);
  });

  it('reports having fed even after the decoder failed', async () => {
    // The latch the commit path reads: a failed session must not hand the turn
    // back to the re-read recogniser, whose wording the policy cannot align
    // against words it has already spoken.
    const stream = new FakeStream();
    const { pipeline } = makePipeline(stream);
    const causal = new CausalTranscriber(pipeline, silentLogger());
    await causal.onAudio(fakeSession('aaa'));
    stream.failFeed = new Error('sidecar down');
    await causal.onAudio(fakeSession('aaabbb'));

    expect(causal.active).toBe(false);
    expect(causal.everFed).toBe(true);
  });

  it('closes a session that arrives after the turn is already gone', async () => {
    // The leak with no owner: a turn that ends inside the opening round trip
    // would otherwise adopt nothing and leave the sidecar holding state until a
    // reaper noticed.
    const stream = new FakeStream();
    const { pipeline } = makePipeline(stream);
    const causal = new CausalTranscriber(pipeline, silentLogger());

    const inFlight = causal.onAudio(fakeSession('aaa'));
    await causal.close();
    await inFlight;
    // The close resolves inside the opener, so give it a tick to land.
    await new Promise((resolve) => setImmediate(resolve));

    expect(stream.closes).toBe(1);
    expect(causal.active).toBe(false);
  });
});
