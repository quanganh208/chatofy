/**
 * Replays real speech through the real capture pump and the real turn pipeline,
 * with the server answering in the WRONG order on purpose.
 *
 * The unit tests next door drive `OrderedPlayback` directly, which proves the
 * ordering rule. They cannot prove the rule is wired to anything: the pump decides
 * where turns begin, the pipeline decides what they are called, and the ordering
 * layer only ever sees the names it is given. A mistake at either seam produces
 * perfectly ordered playback of the wrong turns, or no ordering at all, and every
 * unit test still passes.
 *
 * That is not a hypothetical. The two most expensive defects in this project both
 * reached `main` with every gate green, because the tests covering them described
 * sequences the browser could not produce. So this test produces the sequence the
 * browser does: real synthesized speech, cut by the real length ceiling, with each
 * turn's translation coming back after a delay INVERSELY proportional to how long
 * the turn was — which is exactly the case where the short second sentence
 * overtakes the long first one.
 *
 * Fixtures come from `benchmarks/realtime/generate-fixtures.mjs` and are not
 * committed. Without them the suite skips and says how to make them, rather than
 * passing silently on nothing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionOptions } from '@chatofy/types';
import { CapturePump } from './capture-pump.js';
import { OrderedPlayback, type PlaybackSink } from './ordered-playback.js';
import { downsampleToPcm16, TARGET_SAMPLE_RATE } from './pcm-resampler.js';
import { TurnPipeline, type TurnPipelineTransport } from '../conversation/turn-pipeline.js';

const WORKLET_BLOCK_SAMPLES = 1024;
const FIXTURE_RATE = 48000;
const FIXTURES = join(__dirname, '..', '..', '..', '..', 'benchmarks', 'realtime', 'fixtures');
const manifestPath = join(FIXTURES, 'manifest.json');

interface Fixture {
  id: string;
  file: string;
}

/** Minimal RIFF reader — the fixtures are all 48 kHz mono PCM16. */
function readWavAsFloat(path: string): Float32Array {
  const buffer = readFileSync(path);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`${path} is not a RIFF file`);

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'data') {
      const samples = new Float32Array(size / 2);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = buffer.readInt16LE(offset + 8 + i * 2) / 0x8000;
      }
      return samples;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`${path} has no data chunk`);
}

/** One long stretch of speech with only brief gaps, as a meeting sounds. */
function continuousSpeech(fixtures: Fixture[], repeats: number): Float32Array {
  // Refuse to build silence out of nothing. Every assertion downstream is about
  // the ORDER of turns, and an empty stream produces no turns and no order — so
  // without this the suite reports "expected [] to not deeply equal []" and
  // reads as a broken ordering layer rather than as a missing fixture set.
  if (fixtures.length === 0) throw new Error('continuousSpeech: no fixtures — nothing to replay');
  const clips = fixtures.map((f) => readWavAsFloat(join(FIXTURES, f.file)));
  // 200ms between sentences: too short for the 500ms hangover to end a turn, so
  // the length ceiling is what has to do it.
  const gap = new Float32Array(Math.round(FIXTURE_RATE * 0.2));
  const parts: Float32Array[] = [];
  for (let r = 0; r < repeats; r += 1) {
    for (const clip of clips) {
      parts.push(clip, gap);
    }
  }
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Records the order chunks reach playback, and who was still sounding. */
class RecordingSink implements PlaybackSink {
  readonly turnOrder: string[] = [];
  private readonly sounding = new Set<string>();

  enqueue(turnKey: string): void {
    if (this.turnOrder.at(-1) !== turnKey) this.turnOrder.push(turnKey);
    this.sounding.add(turnKey);
  }
  isPlayingTurn(turnKey: string): boolean {
    return this.sounding.has(turnKey);
  }
  get isPlaying(): boolean {
    return this.sounding.size > 0;
  }
  stop(): void {
    this.sounding.clear();
  }
  stopTurn(turnKey: string): void {
    this.sounding.delete(turnKey);
  }
  finishSounding(turnKey: string): void {
    this.sounding.delete(turnKey);
  }
  /** Turns currently sounding, so the caller can play them out. */
  get soundingNow(): string[] {
    return [...this.sounding];
  }
}

const options: SessionOptions = { direction: 'vi_to_en', voiceGender: 'female' };

/** A turn as the server saw it: how much audio it carried, and its ids. */
interface ServerTurn {
  turnId: string;
  sessionId: string;
  /** Frames received. One frame is one capture block, so this is its length. */
  blocks: number;
}

/**
 * Pipeline latency as a fraction of the turn's own length.
 *
 * A longer turn takes longer to transcribe, translate and synthesize, and that is
 * the entire mechanism behind out-of-order arrival: a long turn that started first
 * can still be working when a short turn that started later has already finished.
 *
 * Expressed as a fraction of turn duration rather than an absolute delay so it
 * scales with the fixtures instead of being tuned to them. At 0.4, a 3s turn is
 * answered 1.2s after it closes — the right order of magnitude against the p50 of
 * 1163ms measured on this repo.
 */
const LATENCY_FRACTION = 0.4;

/**
 * Capture real speech into turns while a fake server answers them out of order.
 *
 * Answers arrive DURING capture, not after it, which matters twice over: it is
 * what production does, and it is what frees slots at the in-flight ceiling so
 * later turns can open at all. A version of this that answered everything at the
 * end had eight of its nine turns refused by the ceiling and asserted almost
 * nothing.
 *
 * Returns the order turns were SPOKEN, the order the server ANSWERED them, and the
 * order they reached playback. The first and last being equal, while the middle
 * differs, is the whole assertion.
 */
function replay(samples: Float32Array, ordered: boolean) {
  const spoken: string[] = [];
  const answered: string[] = [];
  const closedReasons: string[] = [];
  const pipelineLogs: string[] = [];
  const turns = new Map<string, ServerTurn>();
  /** Turns the client has closed, waiting for the server to finish them. */
  const working: { turn: ServerTurn; dueAtBlock: number }[] = [];
  let nextSession = 0;
  let blockIndex = 0;

  const sink = new RecordingSink();
  const playback = new OrderedPlayback(sink);

  /**
   * Play out whatever the ordering layer has released, then let it release more.
   *
   * A loop, because retiring one turn releases the next: a turn whose audio was
   * buffered is only enqueued once every earlier turn has finished, and it cannot
   * report itself drained before it has started sounding. An earlier version of
   * this harness signalled "drained" at completion time instead, which for a
   * buffered turn arrived before its sound did — so the ordering layer waited
   * forever on a turn that was, as far as it could tell, still playing.
   */
  const settlePlayback = () => {
    for (;;) {
      const sounding = sink.soundingNow;
      if (sounding.length === 0) return;
      for (const turnKey of sounding) {
        sink.finishSounding(turnKey);
        playback.onTurnDrained(turnKey);
      }
    }
  };

  /** Deliver a turn's audio and close it, the way the server would. */
  const complete = (turn: ServerTurn) => {
    answered.push(turn.turnId);
    if (ordered) {
      playback.push(turn.turnId, new Int16Array(1600), 16000);
    } else {
      // The control: straight to the sink, the way a queue that schedules by
      // arrival does. This is what the ordering layer is measured against.
      sink.enqueue(turn.turnId);
      sink.finishSounding(turn.turnId);
    }
    pipeline.onServerClosed('completed', { sessionId: turn.sessionId });
    if (ordered) settlePlayback();
  };

  const transport: TurnPipelineTransport = {
    startSession: (_o, turnId) => {
      const sessionId = `s${++nextSession}`;
      turns.set(turnId, { turnId, sessionId, blocks: 0 });
      // The server answers a start synchronously, as it does in production.
      pipeline.onReady(turnId, sessionId);
    },
    sendAudio: (sessionId) => {
      for (const turn of turns.values()) {
        if (turn.sessionId === sessionId) turn.blocks += 1;
      }
    },
    speculate: () => {},
    endSession: (sessionId) => {
      const turn = [...turns.values()].find((t) => t.sessionId === sessionId);
      if (!turn) return;
      working.push({
        turn,
        dueAtBlock: blockIndex + Math.max(1, Math.round(turn.blocks * LATENCY_FRACTION)),
      });
    },
  };

  const pipeline = new TurnPipeline(
    transport,
    {
      onTurnOpened: (turnId) => {
        spoken.push(turnId);
        playback.open(turnId);
      },
      onTurnClosed: (turnId, reason) => {
        closedReasons.push(reason);
        playback.finish(turnId);
      },
      onLog: (message) => pipelineLogs.push(message),
    },
    3,
  );
  pipeline.configure(options);

  const pump = new CapturePump(
    {
      onTurnOpen: (preRoll) => pipeline.openTurn(preRoll),
      onAudio: (block) => pipeline.pushAudio(block),
      onProbableEnd: () => pipeline.speculate(),
      onTurnClose: () => pipeline.closeCapturedTurn(),
      onLevel: () => {},
    },
    Math.floor(WORKLET_BLOCK_SAMPLES / (FIXTURE_RATE / TARGET_SAMPLE_RATE)),
    { fullDuplex: true, continuous: true, maxUtteranceMs: 8000, cutLookaheadMs: 500 },
  );

  /** Finish every turn whose latency has elapsed, soonest first. */
  const settleDue = (upToBlock: number) => {
    for (;;) {
      working.sort((a, b) => a.dueAtBlock - b.dueAtBlock);
      const next = working[0];
      if (!next || next.dueAtBlock > upToBlock) return;
      working.shift();
      complete(next.turn);
    }
  };

  for (
    let offset = 0;
    offset + WORKLET_BLOCK_SAMPLES <= samples.length;
    offset += WORKLET_BLOCK_SAMPLES, blockIndex += 1
  ) {
    pump.push(
      downsampleToPcm16(samples.subarray(offset, offset + WORKLET_BLOCK_SAMPLES), FIXTURE_RATE),
    );
    settleDue(blockIndex);
  }

  // The recording ended; a microphone would carry on. Let the last turns finish.
  settleDue(Number.POSITIVE_INFINITY);

  return {
    spoken,
    played: sink.turnOrder,
    answered,
    closedReasons,
    pipelineLogs,
    /** Speaking order, restricted to the turns the server actually answered. */
    expectedOrder: spoken.filter((turnId) => answered.includes(turnId)),
  };
}

/**
 * The clips this replay needs, in the order it needs them.
 *
 * Long and short ALTERNATE on purpose: pipeline latency here is a fraction of a
 * turn's own length, so a short turn only overtakes a long one when it follows
 * it. Selected by walking this list, not by filtering the manifest — a filter
 * returns manifest order, which groups the longs together and quietly removes
 * the reversal these tests exist to observe.
 */
const REPLAY_FIXTURE_IDS = ['long-01', 'short-01', 'long-02', 'short-02', 'plain-01'];

/**
 * The fixtures named above, or an empty list if this manifest is not the one.
 *
 * `generate-fixtures.mjs` writes synthesized turns chosen for the shape of their
 * pauses; other tools in `benchmarks/realtime/` write real-corpus clips to the
 * SAME manifest path under their own ids. Whichever ran last is what is on disk.
 *
 * That mattered more than it looks: the guard used to be "the manifest file
 * exists", so a manifest carrying the corpus clips selected NOTHING here, and
 * the suite ran on an empty sample buffer. Zero turns, assertions comparing
 * empty arrays, three failures — and green in CI, where no manifest exists at
 * all and the whole thing skipped. A suite written because "the two most
 * expensive defects in this project both reached `main` with every gate green"
 * was doing exactly that. It now skips unless the clips it names are present.
 */
const manifestEntries: Fixture[] = existsSync(manifestPath)
  ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Fixture[])
  : [];

const replayFixtures = REPLAY_FIXTURE_IDS.map((id) =>
  manifestEntries.find((f) => f.id === id),
).filter((f): f is Fixture => f !== undefined && existsSync(join(FIXTURES, f.file)));

const hasFixtures = replayFixtures.length === REPLAY_FIXTURE_IDS.length;

/**
 * Why it skipped, carried in the suite NAME rather than a `console.warn`.
 *
 * A warning logged at module scope is swallowed when the file is skipped, so
 * the one place the reason survives into the report is the title the reporter
 * prints. Says which clips are missing, not just that some are: with two tools
 * writing this manifest, "which family is on disk" is the whole diagnosis.
 */
const missing = REPLAY_FIXTURE_IDS.filter((id) => !replayFixtures.some((f) => f.id === id)).join(
  ', ',
);
const suiteName = hasFixtures
  ? 'OrderedPlayback over real speech'
  : `OrderedPlayback over real speech [no ${missing} in the fixtures manifest — run benchmarks/realtime/generate-fixtures.mjs]`;

describe.skipIf(!hasFixtures)(suiteName, () => {
  const fixtures = replayFixtures;

  it('plays turns in the order they were spoken, not the order they came back', () => {
    const samples = continuousSpeech(fixtures, 3);
    const { spoken, played, answered, expectedOrder } = replay(samples, true);

    // The fixture stream really did produce several turns, or this proves nothing.
    expect(spoken.length).toBeGreaterThan(2);
    // And the server really did answer them out of order, or likewise.
    expect(answered).not.toEqual(expectedOrder);

    expect(played).toEqual(expectedOrder);
  });

  // The test that gives the one above its teeth. Same audio, same inverted answer
  // order, ordering layer bypassed — playback follows arrival and the sequences
  // differ. If this ever starts matching, the fixture stream has stopped
  // exercising the reversal and the test above has quietly stopped meaning
  // anything.
  it('would play them out of order without the ordering layer', () => {
    const samples = continuousSpeech(fixtures, 3);
    const { played, expectedOrder } = replay(samples, false);

    expect(played).not.toEqual(expectedOrder);
  });

  // Every turn the server answered is heard. The last turn spoken is deliberately
  // not among them: the recording ends mid-utterance where a microphone would
  // carry on, so capture never closes it.
  it('loses no answered turn on the way through', () => {
    const samples = continuousSpeech(fixtures, 3);
    const { played, answered, spoken, closedReasons } = replay(samples, true);

    expect([...played].sort()).toEqual([...answered].sort());
    expect(answered).toHaveLength(spoken.length - 1);
    // Nothing was dropped at a ceiling in this run, so every close came from the
    // server. A run that did drop turns has to say so, which is what the logs are
    // asserted for below.
    expect(closedReasons.every((reason) => reason === 'completed')).toBe(true);
  });

  // The bound on "no sentence is lost" is allowed to bite, but never quietly.
  it('logs every turn it gives up on', () => {
    const samples = continuousSpeech(fixtures, 3);
    const { closedReasons, pipelineLogs } = replay(samples, true);

    const givenUp = closedReasons.filter((reason) => reason !== 'completed');
    expect(pipelineLogs.length).toBeGreaterThanOrEqual(givenUp.length);
  });
});

if (!hasFixtures) {
  console.log(
    'ordered-playback.replay: no fixtures — run `node benchmarks/realtime/generate-fixtures.mjs`',
  );
}
